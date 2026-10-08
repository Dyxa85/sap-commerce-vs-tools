import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { beans, loadPlatform, xml } from '../src/index.js';

const fixture = fileURLToPath(new URL('../../test-fixtures/hybris', import.meta.url));
let system: beans.BeanSystem;
beforeAll(async () => {
  system = await beans.buildBeanSystem(await loadPlatform(fixture));
});

describe('parseBeansXml', () => {
  const text = `<beans>
    <import type="x.y.Z"/>
    <bean class="a.b.Foo&lt;T, U>" extends="a.b.Base&lt;T>" abstract="true" deprecated="no">
      <description>Foo bean</description>
      <property name="x" type="java.util.List&lt;T>" equals="true"><description>An x</description></property>
      <property name="y" type="int"/>
      <hints><hint name="wsRelated"/></hints>
    </bean>
    <enum class="a.b.E"><value>ONE</value><value>TWO</value></enum>
  </beans>`;
  const file = beans.parseBeansXml(text, '/f-beans.xml', 'ext');

  it('strips type parameters from class names and keeps them separately', () => {
    expect(file.beans[0]).toMatchObject({
      className: 'a.b.Foo',
      typeParameters: ['T', 'U'],
      extends: 'a.b.Base',
      abstract: true,
      deprecated: 'no',
      description: 'Foo bean',
    });
    expect(file.beans[0]?.hints).toEqual(['wsRelated']);
  });

  it('reads properties, imports and enums with spans', () => {
    expect(file.beans[0]?.properties.map((p) => [p.name, p.type, p.equals])).toEqual([
      ['x', 'java.util.List<T>', true],
      ['y', 'int', undefined],
    ]);
    expect(file.imports[0]?.type).toBe('x.y.Z');
    expect(file.enums[0]?.values.map((v) => v.code)).toEqual(['ONE', 'TWO']);
    const p = file.beans[0]!.properties[0]!;
    expect(text.slice(p.source.nameSpan.start, p.source.nameSpan.end)).toBe('x');
  });

  it('survives broken input', () => {
    expect(
      beans.parseBeansXml('<beans><bean class="a.B"><property name="p" type="', '/b', 'e').beans[0]
        ?.className,
    ).toBe('a.B');
    expect(beans.parseBeansXml('garbage', '/b', 'e').beans).toEqual([]);
  });
});

describe('BeanSystem (fixture)', () => {
  it('merges the beans of the loaded extensions', () => {
    expect(system.beans.size).toBe(3);
    expect(system.enums.size).toBe(1);
    expect(system.has('com.acme.core.dto.BadgeData')).toBe(true);
  });

  it('resolves short names only when unambiguous', () => {
    expect(system.resolve('BadgeData')).toBe('com.acme.core.dto.BadgeData');
    expect(system.resolve('java.util.List<com.acme.core.dto.BadgeData>')).toBeUndefined();
    expect(system.resolve('Nope')).toBeUndefined();
  });

  it('inherits properties', () => {
    const props = system.properties('com.acme.core.dto.BadgeSummaryData');
    expect(props.map((p) => [p.name, p.declaredIn.split('.').pop(), p.own])).toEqual([
      ['code', 'BadgeData', false],
      ['customers', 'BadgeSummaryData', true],
      ['name', 'BadgeData', false],
      ['tier', 'BadgeSummaryData', true],
    ]);
    expect(system.directSubtypes('com.acme.core.dto.BadgeData')).toEqual([
      'com.acme.core.dto.BadgeSummaryData',
    ]);
    expect(
      system.chain('com.acme.core.dto.BadgeSummaryData').map((b) => b.className.split('.').pop()),
    ).toEqual(['BadgeSummaryData', 'BadgeData']);
  });

  it('locates beans and properties', () => {
    const loc = system.locate('BadgeSummaryData', 'tier');
    const file = system.files.find((f) => f.file === loc?.file)!;
    expect(file.text.split('\n')[loc!.start.line]).toContain('name="tier"');
  });

  it('searches beans, enums and properties', () => {
    expect(system.search('badge').map((h) => `${h.kind}:${h.name.split('.').pop()}`)).toEqual(
      expect.arrayContaining(['bean:BadgeData', 'bean:BadgeSummaryData']),
    );
    expect(system.search('tierdata').some((h) => h.kind === 'bean-enum')).toBe(true);
    expect(system.search('summary tier').some((h) => h.kind === 'bean-property')).toBe(true);
  });

  it('describes beans and enums', () => {
    const bean = beans.describeBean(system, 'BadgeSummaryData')!;
    expect(bean).toMatchObject({ kind: 'bean', extends: 'com.acme.core.dto.BadgeData' });
    expect(bean.properties).toHaveLength(4);
    expect(beans.describeBean(system, 'TierData')?.enumValues).toEqual(['BRONZE', 'SILVER']);
    expect(beans.describeBean(system, 'nope')).toBeUndefined();
  });
});

describe('analyzeBeans', () => {
  const run = (text: string, sapOwned = false) =>
    beans
      .analyzeBeans(beans.parseBeansXml(text, '/x-beans.xml', 'x'), system, { sapOwned })
      .map((p) => p.code);

  it('accepts the fixture file', () => {
    const file = system.files.find((f) => f.extension === 'acmecore')!;
    expect(beans.analyzeBeans(file, system)).toEqual([]);
  });

  it('reports structural problems', () => {
    const codes = run(
      '<beans><bean class="NoPackage"><property name="a" type="String"/><property name="a" type=""/></bean><bean class="x.A"/><bean class="x.A"/><enum class="x.E"><value>A</value><value>A</value></enum><enum class="x.F"/></beans>',
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        'beans.class.no-package',
        'beans.property.duplicate',
        'beans.property.no-type',
        'beans.bean.duplicate',
        'beans.enum.duplicate-value',
        'beans.enum.empty',
      ]),
    );
  });

  it('flags an unknown short-name parent but trusts fully qualified Java classes', () => {
    expect(run('<beans><bean class="x.A" extends="Missing"/></beans>')).toContain(
      'beans.extends.unknown',
    );
    expect(run('<beans><bean class="x.A" extends="java.util.Date"/></beans>')).not.toContain(
      'beans.extends.unknown',
    );
    expect(run('<beans><bean class="x.A" extends="BadgeData"/></beans>')).not.toContain(
      'beans.extends.unknown',
    );
  });

  it('shows findings of SAP-owned files only as hints', () => {
    const problems = beans.analyzeBeans(
      beans.parseBeansXml('<beans><bean class="NoPackage"/></beans>', '/x', 'x'),
      system,
      { sapOwned: true },
    );
    expect(problems.every((p) => p.severity === 'hint')).toBe(true);
  });
});

describe('editor features', () => {
  const open = (text: string) => beans.openBeansDocument(text, system);
  const cursor = (s: string) => ({ text: s.replace('|', ''), offset: s.indexOf('|') });

  it('completes parents, property types, booleans and attribute names', () => {
    const parent = cursor('<beans><bean class="x.A" extends="Bad|"');
    expect(beans.completeBeans(open(parent.text), parent.offset).map((e) => e.label)).toContain(
      'com.acme.core.dto.BadgeData',
    );
    const type = cursor('<beans><bean class="x.A"><property name="p" type="|"');
    const labels = beans.completeBeans(open(type.text), type.offset).map((e) => e.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'String',
        'com.acme.core.dto.BadgeData',
        'com.acme.core.enums.TierData',
      ]),
    );
    const bool = cursor('<beans><bean class="x.A" abstract="|"');
    expect(beans.completeBeans(open(bool.text), bool.offset).map((e) => e.label)).toEqual([
      'true',
      'false',
    ]);
    const names = cursor('<beans><bean class="x.A" |');
    expect(beans.completeBeans(open(names.text), names.offset).map((e) => e.label)).toEqual(
      expect.arrayContaining(['extends', 'abstract']),
    );
    const children = cursor('<beans><|');
    expect(beans.completeBeans(open(children.text), children.offset).map((e) => e.label)).toEqual(
      expect.arrayContaining(['bean', 'enum']),
    );
  });

  it('hovers and navigates class references, also inside generics', () => {
    const text =
      '<beans><bean class="x.A" extends="com.acme.core.dto.BadgeData"><property name="p" type="java.util.List&lt;com.acme.core.dto.CustomerRefData>"/></bean></beans>';
    const doc = open(text);
    expect(beans.hoverBeans(doc, text.indexOf('BadgeData') + 2)?.markdown).toContain('bean');
    const target = beans.definitionBeans(doc, text.indexOf('CustomerRefData') + 2);
    expect(
      system.files.find((f) => f.file === target?.file)?.text.split('\n')[target!.start.line],
    ).toContain('CustomerRefData');
    expect(beans.hoverBeans(doc, text.indexOf('name="p"') + 7)?.markdown).toContain('p');
  });

  it('lists beans with their properties in the outline', () => {
    const file = system.files.find((f) => f.extension === 'acmecore')!;
    const symbols = beans.outlineBeans(xml.parseXml(file.text));
    expect(symbols.map((s) => s.name)).toEqual([
      'BadgeData',
      'BadgeSummaryData',
      'CustomerRefData',
      'TierData',
    ]);
    expect(symbols[1]?.children.map((c) => c.name)).toEqual(['customers', 'tier']);
  });
});
