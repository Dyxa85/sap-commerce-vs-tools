import { readFileSync } from 'node:fs';
import type { CompletionEntry } from '../languages/shared/completion.js';
import type { Span } from '../languages/shared/line-index.js';
import type { SchemaLocation } from '../languages/shared/schema.js';
import { LineIndex } from '../languages/shared/line-index.js';
import {
  attr,
  parseXml,
  walk,
  xmlContextAt,
  type XmlDocument,
  type XmlElement,
} from '../xml/index.js';
import type { JavaIndex } from './java-index.js';
import type { SpringSystem } from './system.js';

const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

export interface SpringDocument {
  xml: XmlDocument;
  system: SpringSystem;
  java?: JavaIndex;
}

export function openSpringDocument(
  text: string,
  system: SpringSystem,
  java?: JavaIndex,
): SpringDocument {
  return { xml: parseXml(text), system, java };
}

/** What the cursor is on: a reference to a bean, the id of a bean, or a class name. */
export type SpringTarget =
  | { kind: 'ref'; id: string; span: Span }
  | { kind: 'id'; id: string; span: Span }
  | { kind: 'class'; className: string; span: Span };

const REF_ATTRIBUTES = new Set([
  'parent',
  'ref',
  'bean',
  'local',
  'factory-bean',
  'key-ref',
  'value-ref',
]);

export function targetAt(doc: SpringDocument, offset: number): SpringTarget | undefined {
  for (const el of walk(doc.xml.root)) {
    if (offset < el.startTag.start || offset > el.startTag.end) continue;
    const name = localName(el.name);
    for (const a of el.attributes) {
      if (offset < a.valueSpan.start || offset > a.valueSpan.end) continue;
      if (name === 'alias' && (a.name === 'name' || a.name === 'alias')) {
        return a.name === 'name'
          ? { kind: 'ref', id: a.value.trim(), span: a.valueSpan }
          : { kind: 'id', id: a.value.trim(), span: a.valueSpan };
      }
      if (a.name === 'id') return { kind: 'id', id: a.value.trim(), span: a.valueSpan };
      if (a.name === 'class' && name === 'bean')
        return { kind: 'class', className: a.value.trim(), span: a.valueSpan };
      if (REF_ATTRIBUTES.has(a.name) || /^p:.+-ref$/.test(a.name))
        return { kind: 'ref', id: a.value.trim(), span: a.valueSpan };
      if (a.name === 'depends-on') {
        const rel = offset - a.valueSpan.start;
        for (const m of a.value.matchAll(/[^,;\s]+/g)) {
          const start = m.index ?? 0;
          if (rel >= start && rel <= start + m[0].length)
            return {
              kind: 'ref',
              id: m[0],
              span: {
                start: a.valueSpan.start + start,
                end: a.valueSpan.start + start + m[0].length,
              },
            };
        }
      }
    }
  }
  return undefined;
}

/** Locations of a bean's definitions, or the Java file of a class. */
export function definitionSpring(doc: SpringDocument, offset: number): SchemaLocation[] {
  const target = targetAt(doc, offset);
  if (!target) return [];
  if (target.kind === 'class') {
    const file = doc.java?.fileOf(target.className);
    return file ? [javaLocation(file, target.className)] : [];
  }
  return doc.system.locate(target.id);
}

/** Points at the class declaration inside the Java file when it can be found cheaply. */
function javaLocation(file: string, className: string): SchemaLocation {
  const simple = className.slice(className.lastIndexOf('.') + 1);
  let line = 0;
  let character = 0;
  try {
    const text = readFileSync(file, 'utf8');
    const match = new RegExp(`\\b(?:class|interface|enum|record)\\s+${simple}\\b`).exec(text);
    if (match) {
      const pos = new LineIndex(text).positionAt(match.index + match[0].length - simple.length);
      line = pos.line;
      character = pos.character;
    }
  } catch {
    // unreadable: open at the top
  }
  return { file, start: { line, character }, end: { line, character: character + simple.length } };
}

/** Every place that mentions the bean: its definitions plus all references and aliases. */
export function referencesSpring(doc: SpringDocument, offset: number): SchemaLocation[] {
  const target = targetAt(doc, offset);
  if (!target || target.kind === 'class') return [];
  const locations = [...doc.system.locate(target.id)];
  for (const usage of doc.system.usagesOf(target.id)) {
    const loc = doc.system.locationOf(usage.file, usage.ref.span);
    if (loc) locations.push(loc);
  }
  for (const alias of doc.system.aliases.get(target.id) ?? []) {
    const loc = doc.system.locationOf(alias.file, alias.aliasSpan);
    if (loc) locations.push(loc);
  }
  return locations;
}

export function hoverSpring(
  doc: SpringDocument,
  offset: number,
): { span: Span; markdown: string } | undefined {
  const target = targetAt(doc, offset);
  if (!target) return undefined;
  if (target.kind === 'class') {
    const file = doc.java?.fileOf(target.className);
    return {
      span: target.span,
      markdown: `**${target.className}**${file ? '' : '\n\n_No source file in the loaded extensions (probably packaged in a JAR)._'}`,
    };
  }
  const defs = doc.system.definitions(target.id);
  if (defs.length === 0)
    return { span: target.span, markdown: `**${target.id}** – no such bean or alias` };
  const canonical = doc.system.canonicalId(target.id);
  const effective = defs[defs.length - 1];
  const lines = [`**${canonical}**${canonical !== target.id ? ` (alias \`${target.id}\`)` : ''}`];
  const cls = doc.system.classOf(canonical);
  if (cls) lines.push('', `\`${cls}\``);
  if (effective)
    lines.push(
      '',
      `Defined in \`${effective.extension}\`${effective.scope ? ` · scope ${effective.scope}` : ''}${effective.abstract ? ' · abstract' : ''}`,
    );
  if (defs.length > 1)
    lines.push(
      '',
      `${defs.length} definitions – the one from \`${effective?.extension}\` is used: ${[...new Set(defs.map((d) => d.extension))].join(' → ')}`,
    );
  const aliases = [...doc.system.aliases]
    .filter(([, list]) => list.some((a) => a.name === canonical))
    .map(([name]) => name);
  if (aliases.length > 0)
    lines.push(
      '',
      `Aliases: ${aliases
        .slice(0, 8)
        .map((a) => `\`${a}\``)
        .join(', ')}${aliases.length > 8 ? ', …' : ''}`,
    );
  return { span: target.span, markdown: lines.join('\n') };
}

// ------------------------------------------------------------------ completion

const SCOPES = ['singleton', 'prototype', 'request', 'session', 'application', 'tenant'];

export function completeSpring(doc: SpringDocument, offset: number): CompletionEntry[] {
  const context = xmlContextAt(doc.xml, offset);
  if (context.kind === 'attribute-value') {
    const replace = { start: context.start, end: context.end };
    const element = localName(context.element.name);
    const name = context.attribute.name;
    if (name === 'scope') return SCOPES.map((v) => ({ label: v, kind: 'value' as const, replace }));
    if (['abstract', 'lazy-init', 'primary'].includes(name))
      return ['true', 'false'].map((v) => ({ label: v, kind: 'value' as const, replace }));
    if (
      REF_ATTRIBUTES.has(name) ||
      /^p:.+-ref$/.test(name) ||
      (element === 'alias' && name === 'name')
    ) {
      return doc.system.allIds().map((id) => ({
        label: id,
        kind: 'value' as const,
        detail: doc.system.classOf(id)?.split('.').pop(),
        replace,
        sortText: id,
      }));
    }
    if (name === 'class' && element === 'bean') {
      const typed = context.prefix;
      return (doc.java?.complete(typed, 150) ?? []).map((c) => ({
        label: c,
        kind: 'type' as const,
        replace,
        sortText: c,
      }));
    }
    return [];
  }
  if (context.kind === 'attribute-name') {
    const names = [
      'id',
      'class',
      'parent',
      'scope',
      'abstract',
      'lazy-init',
      'depends-on',
      'init-method',
      'destroy-method',
      'factory-bean',
      'factory-method',
      'primary',
      'name',
    ];
    if (localName(context.element.name) !== 'bean') return [];
    const used = new Set(context.element.attributes.map((a) => a.name));
    return names
      .filter((n) => !used.has(n))
      .map((n) => ({
        label: n,
        kind: 'property' as const,
        insertText: `${n}="$1"`,
        snippet: true,
        replace: { start: context.start, end: offset },
      }));
  }
  const parent =
    context.kind === 'element-name' || context.kind === 'content' ? context.parent : undefined;
  if (parent && localName(parent.name) === 'beans') {
    const prefix = context.kind === 'element-name' ? context.prefix : '';
    const start = context.kind === 'element-name' ? context.start : offset;
    return [
      {
        label: 'bean',
        kind: 'snippet' as const,
        insertText:
          'bean id="${1:defaultMyService}" class="${2:com.acme.service.impl.DefaultMyService}">\n  <property name="${3:dependency}" ref="${4:dependency}"/>\n</bean>',
        snippet: true,
      },
      {
        label: 'alias',
        kind: 'snippet' as const,
        insertText: 'alias name="${1:defaultMyService}" alias="${2:myService}"/>',
        snippet: true,
      },
      {
        label: 'import',
        kind: 'snippet' as const,
        insertText: 'import resource="${1:classpath:/my/config-spring.xml}"/>',
        snippet: true,
      },
    ]
      .filter((e) => e.label.startsWith(prefix))
      .map((e) => ({ ...e, replace: { start, end: offset } }));
  }
  return [];
}

// ------------------------------------------------------------------ structure

export interface SpringSymbol {
  name: string;
  detail?: string;
  kind: 'bean' | 'alias';
  span: Span;
  selection: Span;
}

export function outlineSpring(xml: XmlDocument): SpringSymbol[] {
  const out: SpringSymbol[] = [];
  const root = xml.root;
  if (!root) return out;
  for (const el of root.children as XmlElement[]) {
    const name = localName(el.name);
    const id = el.attributes.find((a) => a.name === 'id');
    if (name === 'alias') {
      const alias = el.attributes.find((a) => a.name === 'alias');
      const target = attr(el, 'name');
      if (alias)
        out.push({
          name: alias.value,
          detail: `→ ${target ?? '?'}`,
          kind: 'alias',
          span: el.span,
          selection: alias.valueSpan,
        });
    } else if (id) {
      out.push({
        name: id.value,
        detail:
          attr(el, 'class')?.split('.').pop() ??
          (attr(el, 'parent') ? `parent ${attr(el, 'parent')}` : undefined),
        kind: 'bean',
        span: el.span,
        selection: id.valueSpan,
      });
    }
  }
  return out;
}
