import { parseJson, type JsonNode } from './json.js';

/** One line of the manifest outline. `offset` is where the entry starts in the file. */
export interface ManifestEntry {
  label: string;
  description?: string;
  offset: number;
  /** The top-level key this entry belongs to (`extensions`, `aspects`, …), used for icons. */
  section: string;
  children: ManifestEntry[];
}

export interface ManifestOutline {
  entries: ManifestEntry[];
  error?: { message: string; offset: number };
}

const LABEL_KEYS = ['name', 'key', 'location', 'addon', 'id'];
const FIRST = ['commerceSuiteVersion', 'solrVersion'];

type Primitive = Exclude<JsonNode, { type: 'object' | 'array' }>;

const isPrimitive = (n: JsonNode): n is Primitive => n.type !== 'object' && n.type !== 'array';
const show = (n: JsonNode): string =>
  n.type === 'string' ? n.value : isPrimitive(n) ? String(n.value) : '';

function describeItem(item: JsonNode, index: number, section: string): ManifestEntry {
  if (isPrimitive(item)) {
    return { label: show(item), offset: item.start, section, children: [] };
  }
  if (item.type === 'array') {
    return {
      label: `#${index + 1}`,
      description: String(item.items.length),
      offset: item.start,
      section,
      children: item.items.map((x, i) => describeItem(x, i, section)),
    };
  }
  const entries = item.entries;
  const labelEntry = LABEL_KEYS.map((k) =>
    entries.find((e) => e.key === k && isPrimitive(e.value)),
  ).find(Boolean);
  const label = labelEntry ? show(labelEntry.value) : `#${index + 1}`;
  // `{ key, value }` is a property, otherwise the other plain values explain the entry
  const valueEntry = entries.find((e) => e.key === 'value' && isPrimitive(e.value));
  const others = entries.filter((e) => e !== labelEntry && isPrimitive(e.value));
  const description =
    labelEntry?.key === 'key' && valueEntry
      ? show(valueEntry.value) || '(empty)'
      : others.map((e) => show(e.value)).join(' · ') || undefined;
  const nested = entries.filter((e) => !isPrimitive(e.value));
  return {
    label,
    description,
    offset: item.start,
    section,
    children: nested.map((e) => describeEntry(e.key, e.value, e.keyStart, section)),
  };
}

function describeEntry(
  key: string,
  value: JsonNode,
  offset: number,
  section: string,
): ManifestEntry {
  if (isPrimitive(value)) {
    return { label: key, description: show(value), offset, section, children: [] };
  }
  if (value.type === 'array') {
    return {
      label: key,
      description: String(value.items.length),
      offset,
      section,
      children: value.items.map((x, i) => describeItem(x, i, section)),
    };
  }
  return {
    label: key,
    offset,
    section,
    children: value.entries.map((e) => describeEntry(e.key, e.value, e.keyStart, section)),
  };
}

/**
 * Turns a CCv2 `manifest.json` into an outline for a tree view. No fixed schema is assumed: plain values become
 * `key  value`, lists show their size, and entries of a list are named by `name`, `key`, `location` or `addon`.
 * That covers `extensions`, `extensionPacks`, `properties`, `useConfig`, `aspects`, `webapps`, `storefrontAddons`, … and
 * whatever SAP adds later.
 */
export function manifestOutline(text: string): ManifestOutline {
  const { root, error } = parseJson(text);
  if (!root) return { entries: [], error };
  if (root.type !== 'object') {
    return {
      entries: [],
      error: { message: 'The manifest must be a JSON object', offset: root.start },
    };
  }
  const entries = root.entries.map((e) => describeEntry(e.key, e.value, e.keyStart, e.key));
  const rank = (e: ManifestEntry): number => {
    const i = FIRST.indexOf(e.label);
    return i < 0 ? FIRST.length : i;
  };
  return { entries: entries.sort((a, b) => rank(a) - rank(b)) };
}
