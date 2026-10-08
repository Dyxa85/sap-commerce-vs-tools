import type { ImpexDocument, MacroDef } from './model.js';

/** Names that are defined by the platform, not by the file. */
export function isBuiltinMacro(name: string): boolean {
  return /^config-/i.test(name) || /^(START|END)_USERRIGHTS$/i.test(name);
}

const indexes = new WeakMap<ImpexDocument, Map<string, MacroDef[]>>();

function indexOf(doc: ImpexDocument): Map<string, MacroDef[]> {
  let index = indexes.get(doc);
  if (!index) {
    index = new Map();
    for (const def of doc.macros) {
      const list = index.get(def.name);
      if (list) list.push(def);
      else index.set(def.name, [def]);
    }
    indexes.set(doc, index);
  }
  return index;
}

/**
 * Finds the definition a use refers to.
 *
 * The importer substitutes macros textually: `$pNone` with `$p=zz` becomes `zzNone`, and when several defined
 * names match, the longest wins (verified on a real instance). So the written name is tried from its full length
 * down to a single character; the latest definition *before* `offset` counts, later definitions are not visible.
 */
export function resolveMacroName(
  doc: ImpexDocument,
  written: string,
  offset: number,
): { def: MacroDef; length: number } | undefined {
  const index = indexOf(doc);
  for (let length = written.length; length > 0; length--) {
    const defs = index.get(written.slice(0, length));
    if (!defs) continue;
    for (let i = defs.length - 1; i >= 0; i--) {
      const def = defs[i] as MacroDef;
      if (def.span.start < offset) return { def, length };
    }
  }
  return undefined;
}

/** Expands macros in a definition value (for hover), guarding against cycles. */
export function expandMacros(doc: ImpexDocument, text: string, offset: number, depth = 0): string {
  if (depth > 8) return text;
  return text.replace(/\$([A-Za-z_][\w.-]*)/g, (match, name: string) => {
    const hit = resolveMacroName(doc, name, offset);
    if (!hit) return match;
    const expanded = expandMacros(doc, hit.def.value, hit.def.span.start, depth + 1);
    return expanded + name.slice(hit.length);
  });
}
