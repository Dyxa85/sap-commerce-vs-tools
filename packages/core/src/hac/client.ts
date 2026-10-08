import { HacAuthError, HacProtocolError, HacQueryError } from './errors.js';
import {
  decodeEntities,
  extractCsrfToken,
  extractImpexDetails,
  extractResultSpan,
  looksLikeLoginPage,
} from './html.js';
import { HttpSession, type HttpResponse } from './http.js';
import type {
  ImpexOptions,
  ImpexResult,
  LoggerInfo,
  PkAnalysis,
  QueryOptions,
  QueryResult,
  ScriptOptions,
  ScriptResult,
} from './types.js';

export interface HacClientOptions {
  /** e.g. https://localhost:9002/hac */
  baseUrl: string;
  username: string;
  password: string;
  ignoreTlsErrors?: boolean;
  timeoutMs?: number;
}

type Form = Record<string, string | boolean | number | undefined>;

const PAGE = {
  flexsearch: '/console/flexsearch',
  scripting: '/console/scripting',
  impex: '/console/impex/import',
  pk: '/platform/pkanalyzer',
  log4j: '/platform/log4j',
} as const;

/**
 * Client for the hAC web console endpoints (contract: docs/hac-api.md).
 * One instance = one session. Re-authenticates once automatically when the session or CSRF token is rejected.
 */
export class HacClient {
  private readonly http: HttpSession;
  private loggedIn = false;
  private csrf: string | undefined;

  constructor(private readonly options: HacClientOptions) {
    this.http = new HttpSession({
      baseUrl: options.baseUrl,
      ignoreTlsErrors: options.ignoreTlsErrors,
      timeoutMs: options.timeoutMs,
    });
  }

  dispose(): void {
    this.http.dispose();
  }

  /** Explicit login, e.g. for "Test connection". Other methods log in lazily. */
  async login(signal?: AbortSignal): Promise<void> {
    this.http.clearCookies();
    this.loggedIn = false;
    this.csrf = undefined;

    const loginPage = await this.http.request('GET', '/login', { signal });
    const token = extractCsrfToken(loginPage.body);
    if (loginPage.status !== 200 || !token) {
      throw new HacProtocolError(
        `Unexpected login page (HTTP ${loginPage.status}). Is "${this.http.base.href}" the hAC URL?`,
        loginPage.status,
      );
    }

    const result = await this.http.request('POST', '/j_spring_security_check', {
      signal,
      form: new URLSearchParams({
        j_username: this.options.username,
        j_password: this.options.password,
        _csrf: token,
      }),
    });

    const location = result.headers.location ?? '';
    if (result.status !== 302 && result.status !== 303) {
      throw new HacProtocolError(
        `Unexpected login response (HTTP ${result.status})`,
        result.status,
      );
    }
    if (/login/i.test(location)) {
      throw new HacAuthError('Login failed: wrong user name or password');
    }
    this.loggedIn = true;
  }

  async logout(): Promise<void> {
    if (!this.loggedIn) return;
    try {
      const token = await this.fetchToken(PAGE.flexsearch);
      await this.http.request('POST', '/j_spring_security_logout', {
        form: new URLSearchParams({ _csrf: token }),
      });
    } finally {
      this.http.clearCookies();
      this.loggedIn = false;
      this.csrf = undefined;
    }
  }

  // ---------------------------------------------------------------- queries

  /** FlexibleSearch. */
  flexibleSearch(options: QueryOptions, signal?: AbortSignal): Promise<QueryResult> {
    return this.query({ flexibleSearchQuery: options.query, sqlQuery: '' }, options, signal);
  }

  /** Raw SQL against the database of the data source. */
  sql(options: QueryOptions, signal?: AbortSignal): Promise<QueryResult> {
    return this.query({ flexibleSearchQuery: '', sqlQuery: options.query }, options, signal);
  }

  private async query(
    queries: { flexibleSearchQuery: string; sqlQuery: string },
    options: QueryOptions,
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    const json = await this.postJson(
      PAGE.flexsearch,
      '/console/flexsearch/execute',
      {
        ...queries,
        maxCount: options.maxCount ?? 200,
        user: options.user ?? this.options.username,
        locale: options.locale ?? 'en',
        dataSource: options.dataSource ?? 'master',
        commit: options.commit ?? false,
      },
      signal,
    );
    const body = asRecord(json, 'FlexSearch response');
    if (body.exception) throw toQueryError(body.exception, asString(body.exceptionStackTrace));
    return {
      columns: asStringArray(body.headers),
      rows: asRows(body.resultList),
      rowCount: asNumber(body.resultCount),
      executionTimeMs: asNumber(body.executionTime),
      query: typeof body.query === 'string' ? body.query : undefined,
      dataSource: asString(body.dataSourceId) || undefined,
      raw: body.rawExecution === true,
    };
  }

  // ---------------------------------------------------------------- scripts

  /** Groovy / BeanShell / JavaScript. Runs in rollback mode unless `commit` is true. */
  async executeScript(options: ScriptOptions, signal?: AbortSignal): Promise<ScriptResult> {
    const json = await this.postJson(
      PAGE.scripting,
      '/console/scripting/execute',
      {
        script: options.script,
        scriptType: options.scriptType ?? 'groovy',
        commit: options.commit ?? false,
      },
      signal,
    );
    const body = asRecord(json, 'Script response');
    return {
      result: asString(body.executionResult),
      output: asString(body.outputText),
      stacktrace: asString(body.stacktraceText),
      failed: asString(body.stacktraceText).trim() !== '',
    };
  }

  // ---------------------------------------------------------------- impex

  validateImpex(
    script: string,
    options?: ImpexOptions,
    signal?: AbortSignal,
  ): Promise<ImpexResult> {
    return this.impex(
      '/console/impex/import/validate',
      'validationResultMsg',
      script,
      options,
      signal,
    );
  }

  importImpex(script: string, options?: ImpexOptions, signal?: AbortSignal): Promise<ImpexResult> {
    return this.impex('/console/impex/import', 'impexResult', script, options, signal);
  }

  private async impex(
    action: string,
    spanId: string,
    script: string,
    options: ImpexOptions = {},
    signal?: AbortSignal,
  ): Promise<ImpexResult> {
    const flags: Record<string, boolean> = {
      legacyMode: options.legacyMode ?? false,
      enableCodeExecution: options.enableCodeExecution ?? false,
      distributedMode: options.distributedMode ?? false,
      sldEnabled: options.sldEnabled ?? false,
    };
    const form: Form = {
      scriptContent: script,
      validationEnum: options.validation ?? 'IMPORT_STRICT',
      encoding: options.encoding ?? 'UTF-8',
      maxThreads: options.maxThreads ?? 1,
    };
    for (const [name, on] of Object.entries(flags)) {
      if (on) form[name] = true;
      form[`_${name}`] = 'on'; // Spring form checkbox marker, always sent
    }

    const html = await this.postHtml(PAGE.impex, action, form, signal);
    const span = extractResultSpan(html, spanId);
    if (!span) {
      throw new HacProtocolError(`ImpEx response did not contain the "${spanId}" result element`);
    }
    return {
      ok: span.level !== 'error',
      level: span.level,
      message: span.message,
      details: spanId === 'impexResult' ? extractImpexDetails(html) : undefined,
    };
  }

  // ---------------------------------------------------------------- misc tools

  async analyzePk(pk: string, signal?: AbortSignal): Promise<PkAnalysis> {
    const json = await this.postJson(
      PAGE.pk,
      '/platform/pkanalyzer/analyze',
      { pkString: pk },
      signal,
    );
    const body = asRecord(json, 'PK analyzer response');
    const failure = body.possibleException;
    if (failure && typeof failure === 'object') {
      throw new HacQueryError(
        asString((failure as Record<string, unknown>).message) || 'Invalid PK',
        '',
        '',
      );
    }
    return {
      pk: asString(body.pkString),
      counterBased: body.counterBased === true,
      typeCode: asNumber(body.pkTypeCode),
      composedTypeCode: asString(body.pkComposedTypeCode) || undefined,
      clusterId: asNumber(body.pkClusterId),
      creationDate: asString(body.pkCreationDate) || undefined,
      hex: asString(body.pkAsHex) || undefined,
      raw: body,
    };
  }

  /** Reads the loggers table from the log4j page. */
  async listLoggers(signal?: AbortSignal): Promise<LoggerInfo[]> {
    const html = await this.getPage(PAGE.log4j, signal);
    const table = /<table\s+id="loggers"[\s\S]*?<\/table>/i.exec(html)?.[0] ?? '';
    const loggers: LoggerInfo[] = [];
    for (const row of table.split(/<tr\b/i).slice(2)) {
      const cells = [...row.matchAll(/<td\s+title="([^"]*)"/gi)].map((m) =>
        decodeEntities(m[1] ?? ''),
      );
      const name = cells[0];
      if (!name) continue;
      const selected = /<option\s+value="([^"]+)"\s+selected/i.exec(row)?.[1] ?? '';
      loggers.push({ name, parent: cells[1] || undefined, level: selected });
    }
    return loggers;
  }

  /** Changes a log level in the running instance (not persisted across restarts). */
  async setLoggerLevel(loggerName: string, levelName: string, signal?: AbortSignal): Promise<void> {
    if (!/^\w+(\.\w+)*$/.test(loggerName)) {
      throw new HacQueryError(`Invalid logger name: ${loggerName}`, '', '');
    }
    await this.postJson(
      PAGE.log4j,
      '/platform/log4j/changeLevel',
      { loggerName, levelName },
      signal,
    );
  }

  // ---------------------------------------------------------------- plumbing

  private async ensureLoggedIn(signal?: AbortSignal): Promise<void> {
    if (!this.loggedIn) await this.login(signal);
  }

  private async fetchToken(page: string, signal?: AbortSignal): Promise<string> {
    const res = await this.http.request('GET', page, { signal });
    if (res.status >= 300 || looksLikeLoginPage(res.body)) {
      this.loggedIn = false;
      throw new HacAuthError('Session expired');
    }
    const token = extractCsrfToken(res.body);
    if (!token) throw new HacProtocolError(`No CSRF token on page ${page}`, res.status);
    this.csrf = token;
    return token;
  }

  private async getPage(page: string, signal?: AbortSignal): Promise<string> {
    return this.withSession(signal, async () => {
      const res = await this.http.request('GET', page, { signal });
      if (res.status >= 300 || looksLikeLoginPage(res.body)) return undefined;
      return res.body;
    });
  }

  private async postJson(
    page: string,
    action: string,
    form: Form,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const text = await this.postRaw(page, action, form, 'application/json', signal);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HacProtocolError(`Response of ${action} is not valid JSON`);
    }
  }

  private postHtml(
    page: string,
    action: string,
    form: Form,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.postRaw(page, action, form, 'text/html', signal);
  }

  private postRaw(
    page: string,
    action: string,
    form: Form,
    accept: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.withSession(signal, async () => {
      const token = this.csrf ?? (await this.fetchToken(page, signal));
      const res: HttpResponse = await this.http.request('POST', action, {
        signal,
        headers: { 'X-CSRF-TOKEN': token, Accept: accept },
        form: toForm(form),
      });
      // The hAC answers 405 for a missing/invalid CSRF token or a dead session.
      if (res.status === 405 || res.status === 401 || res.status === 403) {
        this.csrf = undefined;
        return undefined;
      }
      if (res.status >= 300 && res.status < 400) return undefined;
      if (res.status !== 200) {
        throw new HacProtocolError(`Unexpected HTTP ${res.status} from ${action}`, res.status);
      }
      if (accept === 'application/json' && looksLikeLoginPage(res.body)) return undefined;
      return res.body;
    });
  }

  /** Runs `attempt`; when it yields `undefined` (session/CSRF rejected) logs in again and retries exactly once. */
  private async withSession(
    signal: AbortSignal | undefined,
    attempt: () => Promise<string | undefined>,
  ): Promise<string> {
    await this.ensureLoggedIn(signal);
    const first = await attempt().catch(handleExpired);
    if (first !== undefined) return first;

    await this.login(signal);
    const second = await attempt().catch(handleExpired);
    if (second !== undefined) return second;
    throw new HacAuthError(
      'The hAC rejected the session or CSRF token even after logging in again',
    );
  }
}

function handleExpired(err: unknown): undefined {
  if (err instanceof HacAuthError && err.message === 'Session expired') return undefined;
  throw err;
}

function toForm(form: Form): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value !== undefined) out.append(key, String(value));
  }
  return out;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new HacProtocolError(`${what} has an unexpected shape`);
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNumber = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const asStringArray = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
const asRows = (v: unknown): string[][] =>
  Array.isArray(v)
    ? v.map((row) => (Array.isArray(row) ? row.map((c) => (c === null ? '' : String(c))) : []))
    : [];

/** Walks the serialized Throwable (`message`, `cause`) to build a readable error. */
function toQueryError(exception: unknown, stackTrace: string): HacQueryError {
  let message = '';
  let root = '';
  let node: unknown = exception;
  for (let depth = 0; node && typeof node === 'object' && depth < 20; depth++) {
    const record = node as Record<string, unknown>;
    const current = asString(record.message);
    if (current) {
      if (!message) message = current;
      root = current;
    }
    node = record.cause;
  }
  return new HacQueryError(message || 'Query failed', root || message, stackTrace);
}
