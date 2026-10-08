import { normalizeBaseUrl, slugify, type ConnectionConfig } from './model.js';

/** What the connections page sends when the user presses "Save". Everything is untrusted until validated. */
export interface ConnectionForm {
  originalId?: unknown;
  name?: unknown;
  url?: unknown;
  username?: unknown;
  password?: unknown;
  ignoreTlsErrors?: unknown;
  protected?: unknown;
  locale?: unknown;
  dataSource?: unknown;
}

export type FormResult =
  | { ok: true; connection: ConnectionConfig; password?: string; originalId?: string }
  | { ok: false; field: string; message: string };

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Checks the form like the settings validation does, and says which field is wrong. */
export function validateConnectionForm(
  form: ConnectionForm,
  existing: readonly ConnectionConfig[],
): FormResult {
  const originalId =
    typeof form.originalId === 'string' && form.originalId ? form.originalId : undefined;
  const name = text(form.name);
  if (!name)
    return { ok: false, field: 'name', message: 'A name is required, e.g. "Local" or "Dev".' };
  if (name.length > 60)
    return { ok: false, field: 'name', message: 'Use a shorter name (60 characters at most).' };
  const id = slugify(name);
  if (existing.some((c) => c.id === id && c.id !== originalId)) {
    return { ok: false, field: 'name', message: 'A connection with this name already exists.' };
  }

  const rawUrl = text(form.url);
  const url = rawUrl ? normalizeBaseUrl(rawUrl) : undefined;
  if (!url) {
    return {
      ok: false,
      field: 'url',
      message:
        'Enter the hAC address, e.g. https://localhost:9002/hac (no user name or password in it).',
    };
  }

  const username = text(form.username);
  if (!username) return { ok: false, field: 'username', message: 'A user name is required.' };

  const locale = text(form.locale);
  if (locale && !/^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})?$/.test(locale)) {
    return { ok: false, field: 'locale', message: 'A locale looks like "en" or "de_DE".' };
  }
  const dataSource = text(form.dataSource);
  if (dataSource && !/^[\w.-]{1,60}$/.test(dataSource)) {
    return {
      ok: false,
      field: 'dataSource',
      message: 'A data source id has only letters, digits, "_", "-" and ".".',
    };
  }

  const password =
    typeof form.password === 'string' && form.password !== '' ? form.password : undefined;
  return {
    ok: true,
    originalId,
    password,
    connection: {
      id,
      name,
      url,
      username,
      ignoreTlsErrors: form.ignoreTlsErrors === true && url.startsWith('https:'),
      protected: form.protected === true,
      locale: locale || undefined,
      dataSource: dataSource || undefined,
    },
  };
}
