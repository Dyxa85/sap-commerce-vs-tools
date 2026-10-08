import { dirname, isAbsolute, join, resolve } from 'node:path';
import { attr, attrNode, parseXml, walk } from '../xml/parser.js';
import type { LocalExtensions, PlatformProblem } from './model.js';

export interface Variables {
  HYBRIS_BIN_DIR: string;
  HYBRIS_CONFIG_DIR: string;
  HYBRIS_DATA_DIR: string;
  platformhome: string;
  [name: string]: string;
}

/** Replaces `${NAME}`; unknown variables are reported and left untouched. */
export function resolveVariables(
  input: string,
  variables: Variables,
  onUnknown?: (name: string) => void,
): string {
  return input.replace(/\$\{([^}]+)\}/g, (match, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      onUnknown?.(name);
      return match;
    }
    return value;
  });
}

/** Parses `config/localextensions.xml`. */
export function parseLocalExtensions(
  text: string,
  file: string,
  variables: Variables,
): LocalExtensions {
  const doc = parseXml(text);
  const result: LocalExtensions = { file, scanPaths: [], entries: [], problems: [] };
  const problem = (
    severity: PlatformProblem['severity'],
    message: string,
    span?: PlatformProblem['span'],
  ): void => {
    result.problems.push({ severity, message, file, span });
  };
  for (const p of doc.problems) problem('error', p.message, p.span);

  const base = dirname(file);
  const toAbsolute = (value: string): string => (isAbsolute(value) ? value : resolve(base, value));

  for (const el of walk(doc.root)) {
    if (el.name === 'path') {
      const dirAttr = attrNode(el, 'dir');
      if (!dirAttr) {
        problem('error', '<path> needs a "dir" attribute', el.nameSpan);
        continue;
      }
      const dir = toAbsolute(
        resolveVariables(dirAttr.value, variables, (n) =>
          problem('warning', `Unknown variable \${${n}}`, dirAttr.valueSpan),
        ),
      );
      result.scanPaths.push({
        dir,
        autoload: attr(el, 'autoload')?.toLowerCase() !== 'false',
        span: el.span,
      });
    } else if (el.name === 'extension') {
      const name = attrNode(el, 'name');
      const dirAttr = attrNode(el, 'dir');
      if (dirAttr) {
        const dir = toAbsolute(
          resolveVariables(dirAttr.value, variables, (n) =>
            problem('warning', `Unknown variable \${${n}}`, dirAttr.valueSpan),
          ),
        );
        result.entries.push({ kind: 'dir', dir, span: el.span });
      } else if (name) {
        result.entries.push({ kind: 'name', name: name.value.trim(), span: el.span });
      } else {
        problem('error', '<extension> needs a "name" or "dir" attribute', el.nameSpan);
      }
    }
  }
  return result;
}

export function defaultVariables(hybrisDir: string): Variables {
  const binDir = join(hybrisDir, 'bin');
  return {
    HYBRIS_BIN_DIR: binDir,
    HYBRIS_CONFIG_DIR: join(hybrisDir, 'config'),
    HYBRIS_DATA_DIR: join(hybrisDir, 'data'),
    HYBRIS_LOG_DIR: join(hybrisDir, 'log'),
    HYBRIS_TEMP_DIR: join(hybrisDir, 'temp'),
    platformhome: join(binDir, 'platform'),
  };
}
