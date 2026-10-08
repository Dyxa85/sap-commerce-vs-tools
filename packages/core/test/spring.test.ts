import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPlatform, spring, xml } from '../src/index.js';

const fixture = fileURLToPath(new URL('../../test-fixtures/hybris', import.meta.url));
let system: spring.SpringSystem;
let java: spring.JavaIndex;
beforeAll(async () => {
  const project = await loadPlatform(fixture);
  system = await spring.buildSpringSystem(project);
  java = await spring.buildJavaIndex(project);
});

describe('parseSpringXml', () => {
  const text = `<beans xmlns="http://www.springframework.org/schema/beans" xmlns:util="u" xmlns:int="i" xmlns:p="p">
    <import resource="classpath:/x-spring.xml"/>
    <alias name="a" alias="b"/>
    <bean id="a" name="n1, n2" class="x.A" parent="p" scope="prototype" depends-on="d1, d2" p:svc-ref="s" abstract="true">
      <property name="r" ref="r1"/>
      <property name="v" value="1"/>
      <constructor-arg ref="c1"/>
      <property name="list"><list><ref bean="in1"/><bean class="x.Inner"><property name="deep" ref="inner-only"/></bean></list></property>
      <property name="map"><map><entry key-ref="k" value-ref="v"/></map></property>
      <property name="expr" ref="#{ignored}"/>
    </bean>
    <util:list id="lst"/>
    <int:channel id="channel1"/>
    <context:component-scan base-package="com.acme"/>
  </beans>`;
  const file = spring.parseSpringXml(text, '/f-spring.xml', 'ext');

  it('reads beans, aliases, imports and component scans', () => {
    // document order; the inner bean of the list is anonymous
    expect(file.beans.map((b) => b.id)).toEqual(['a', undefined, 'lst', 'channel1']);
    expect(file.aliases[0]).toMatchObject({ name: 'a', alias: 'b' });
    expect(file.imports[0]?.resource).toBe('classpath:/x-spring.xml');
    expect(file.componentScans[0]?.basePackage).toBe('com.acme');
  });

  it('collects all kinds of references of a bean and not those of inner beans', () => {
    const targets = file.beans[0]!.refs.map((r) => `${r.kind}:${r.target}`).sort();
    expect(targets).toEqual([
      'depends-on:d1',
      'depends-on:d2',
      'parent:p',
      'ref:c1',
      'ref:in1',
      'ref:k',
      'ref:r1',
      'ref:s',
      'ref:v',
    ]);
    expect(file.beans[0]).toMatchObject({
      names: ['n1', 'n2'],
      className: 'x.A',
      scope: 'prototype',
      abstract: true,
    });
  });
});

describe('SpringSystem (fixture)', () => {
  it('resolves aliases and finds the class through parents', () => {
    expect(system.canonicalId('acmeBadgeService')).toBe('defaultAcmeBadgeService');
    expect(system.has('acmeBadgeService')).toBe(true);
    expect(system.has('nope')).toBe(false);
    expect(system.classOf('abstractService')).toBe('com.fixture.core.AbstractService');
  });

  it('applies the override rule: the extension loaded last wins', () => {
    const defs = system.definitions('acmeBadgeService');
    expect(defs.map((d) => d.extension)).toEqual(['acmecore', 'acmefacades']);
    expect(system.effective('acmeBadgeService')?.className).toBe(
      'com.acme.facades.CachingBadgeService',
    );
    expect(system.classOf('defaultAcmeBadgeService')).toBe('com.acme.facades.CachingBadgeService');
  });

  it('finds usages through aliases and parents', () => {
    const usages = system.usagesOf('modelService').map((u) => u.bean?.id);
    expect(usages).toEqual(expect.arrayContaining(['abstractService', 'defaultAcmeBadgeService']));
    expect(system.usagesOf('defaultAcmeBadgeService').some((u) => u.alias)).toBe(true); // the alias definition
    expect(system.usagesOf('acmeBadgeService').some((u) => u.bean?.id === 'badgeFacade')).toBe(
      true,
    ); // p:…-ref via alias
  });

  it('searches by id and class', () => {
    expect(system.search('badge facade').map((h) => h.id)).toContain('badgeFacade');
    expect(system.search('cachingbadge')[0]?.overrides).toBe(1);
  });

  it('indexes the Java sources of the loaded extensions', () => {
    expect(java.fileOf('com.acme.core.service.impl.DefaultAcmeBadgeService')).toBe(
      join(
        fixture,
        'bin',
        'custom',
        'acmecore',
        'src',
        'com',
        'acme',
        'core',
        'service',
        'impl',
        'DefaultAcmeBadgeService.java',
      ),
    );
    expect(java.fileOf('com.nope.Missing')).toBeUndefined();
    expect(java.complete('badgeservice').length).toBe(1);
  });
});

describe('analyzeSpring', () => {
  const analyze = (file: string, ext: string, sapOwned = false) => {
    const parsed = system.files.find((f) => f.extension === ext && f.file.endsWith(file))!;
    return spring.analyzeSpring(parsed, system, { sapOwned });
  };

  it('reports an unknown reference, notes overrides and does not complain about aliases or p:…-ref', () => {
    const problems = analyze('acmefacades-spring.xml', 'acmefacades');
    expect(problems.find((p) => p.code === 'spring.ref.unknown')?.message).toContain(
      'badgeConverter',
    );
    expect(problems.some((p) => p.code === 'spring.bean.overrides')).toBe(true);
    expect(problems.filter((p) => p.code === 'spring.ref.unknown')).toHaveLength(1);
  });

  it('marks the overridden definition', () => {
    const problems = analyze('acmecore-spring.xml', 'acmecore');
    expect(problems.find((p) => p.code === 'spring.bean.overridden')?.message).toContain(
      'acmefacades',
    );
    expect(problems.some((p) => p.code === 'spring.ref.unknown')).toBe(false);
  });

  it('reports duplicate ids, missing classes and dangling aliases', () => {
    const file = spring.parseSpringXml(
      '<beans><bean id="x" class="a.B"/><bean id="x" class="a.B"/><bean id="y"/><alias name="ghost" alias="g"/><bean id="z" class="a.B" parent="ghost2"/></beans>',
      '/t-spring.xml',
      'tmp',
    );
    const codes = spring.analyzeSpring(file, system).map((p) => p.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'spring.bean.duplicate-id',
        'spring.bean.no-class',
        'spring.alias.unknown-target',
        'spring.parent.unknown',
      ]),
    );
  });

  it('downgrades findings in SAP-owned files', () => {
    const file = spring.parseSpringXml('<beans><bean id="y"/></beans>', '/t-spring.xml', 'tmp');
    expect(
      spring.analyzeSpring(file, system, { sapOwned: true }).every((p) => p.severity === 'hint'),
    ).toBe(true);
  });
});

describe('editor features', () => {
  const open = (text: string) => spring.openSpringDocument(text, system, java);
  const cursor = (s: string) => ({ text: s.replace('|', ''), offset: s.indexOf('|') });

  it('navigates from refs (all definitions), aliases and classes', () => {
    const text =
      '<beans><bean id="x" class="com.acme.core.service.impl.DefaultAcmeBadgeService"><property name="s" ref="acmeBadgeService"/></bean></beans>';
    const doc = open(text);
    expect(spring.definitionSpring(doc, text.indexOf('acmeBadgeService') + 3)).toHaveLength(2);
    const cls = spring.definitionSpring(doc, text.indexOf('DefaultAcmeBadgeService') + 3);
    expect(cls[0]?.file).toMatch(/DefaultAcmeBadgeService\.java$/);
    expect(cls[0]?.start.line).toBe(3); // the class declaration line
  });

  it('finds references: definitions, refs, parents and aliases', () => {
    const text = '<beans><bean id="modelService" class="x.Y"/></beans>';
    const refs = spring.referencesSpring(open(text), text.indexOf('modelService') + 2);
    expect(refs.length).toBeGreaterThanOrEqual(3);
  });

  it('shows hover information with aliases and overrides', () => {
    const text = '<beans><property name="s" ref="acmeBadgeService"/></beans>';
    const md = spring.hoverSpring(open(text), text.indexOf('acmeBadgeService') + 2)?.markdown ?? '';
    expect(md).toContain('defaultAcmeBadgeService');
    expect(md).toContain('acmecore → acmefacades');
  });

  it('completes bean ids, scopes, attributes and structure', () => {
    const ref = cursor('<beans><bean id="x" class="a.B"><property name="p" ref="|"');
    expect(spring.completeSpring(open(ref.text), ref.offset).map((e) => e.label)).toEqual(
      expect.arrayContaining(['modelService', 'acmeBadgeService']),
    );
    const scope = cursor('<beans><bean id="x" scope="|"');
    expect(spring.completeSpring(open(scope.text), scope.offset).map((e) => e.label)).toContain(
      'prototype',
    );
    const cls = cursor('<beans><bean id="x" class="Caching|"');
    expect(spring.completeSpring(open(cls.text), cls.offset).map((e) => e.label)).toEqual([]); // no source for that class name
    const cls2 = cursor('<beans><bean id="x" class="AcmeBadge|"');
    expect(spring.completeSpring(open(cls2.text), cls2.offset).map((e) => e.label)).toContain(
      'com.acme.core.service.impl.DefaultAcmeBadgeService',
    );
    const names = cursor('<beans><bean |');
    expect(spring.completeSpring(open(names.text), names.offset).map((e) => e.label)).toEqual(
      expect.arrayContaining(['id', 'class', 'parent']),
    );
    const children = cursor('<beans><|');
    expect(spring.completeSpring(open(children.text), children.offset).map((e) => e.label)).toEqual(
      expect.arrayContaining(['bean', 'alias']),
    );
  });

  it('builds the outline', () => {
    const file = system.files.find((f) => f.extension === 'acmecore')!;
    expect(spring.outlineSpring(xml.parseXml(file.text)).map((s) => `${s.kind}:${s.name}`)).toEqual(
      ['alias:acmeBadgeService', 'bean:defaultAcmeBadgeService'],
    );
  });
});
