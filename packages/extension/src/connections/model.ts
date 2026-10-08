/** Pure connection model (no vscode dependency, unit-tested). Passwords are never part of it. */

export interface ConnectionConfig {
  /** Stable id, derived from the name. Key for the stored password. */
  id: string;
  name: string;
  /** Normalised hAC base URL including the context path, no trailing slash. */
  url: string;
  username: string;
  ignoreTlsErrors: boolean;
  /** Protected connections ask before any write/commit action. */
  protected: boolean;
  locale?: string;
  dataSource?: string;
}

export interface ConnectionProblem {
  index: number;
  message: string;
}

export interface NormalizedConnections {
  connections: ConnectionConfig[];
  problems: ConnectionProblem[];
}

/** Accepts "localhost:9002", "https://host:9002" and full "…/hac" URLs. */
export function normalizeBaseUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined; // credentials never belong into the URL
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path === '' ? '/hac' : path;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

/**
 * True for plain `http://` to a host other than this machine: password and results would cross the network
 * unencrypted. Loopback addresses and `*.localhost` are fine.
 */
export function isInsecureRemote(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return !(
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'connection' : slug;
}

/** Validates raw settings values; invalid entries are reported, not thrown. */
export function normalizeConnections(raw: unknown): NormalizedConnections {
  const connections: ConnectionConfig[] = [];
  const problems: ConnectionProblem[] = [];
  if (raw === undefined || raw === null) return { connections, problems };
  if (!Array.isArray(raw)) {
    return {
      connections,
      problems: [{ index: -1, message: '"sapcommerce.connections" must be an array' }],
    };
  }
  const usedIds = new Set<string>();

  raw.forEach((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null) {
      problems.push({ index, message: 'entry is not an object' });
      return;
    }
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    const username = typeof e.username === 'string' ? e.username.trim() : '';
    const url = typeof e.url === 'string' ? normalizeBaseUrl(e.url) : undefined;
    if (!name) return void problems.push({ index, message: '"name" is required' });
    if (!url) return void problems.push({ index, message: `"${name}": invalid "url"` });
    if (!username)
      return void problems.push({ index, message: `"${name}": "username" is required` });
    if ('password' in e) {
      problems.push({
        index,
        message: `"${name}": do not store passwords in settings – the password is kept in VS Code's secret storage`,
      });
    }

    let id = slugify(name);
    for (let n = 2; usedIds.has(id); n++) id = `${slugify(name)}-${n}`;
    usedIds.add(id);

    connections.push({
      id,
      name,
      url,
      username,
      ignoreTlsErrors: e.ignoreTlsErrors === true,
      protected: e.protected === true,
      locale: typeof e.locale === 'string' && e.locale ? e.locale : undefined,
      dataSource: typeof e.dataSource === 'string' && e.dataSource ? e.dataSource : undefined,
    });
  });

  return { connections, problems };
}

/** Shape written back to settings (without derived id). */
export function toSettingsEntry(c: ConnectionConfig): Record<string, unknown> {
  const entry: Record<string, unknown> = { name: c.name, url: c.url, username: c.username };
  if (c.ignoreTlsErrors) entry.ignoreTlsErrors = true;
  if (c.protected) entry.protected = true;
  if (c.locale) entry.locale = c.locale;
  if (c.dataSource) entry.dataSource = c.dataSource;
  return entry;
}
