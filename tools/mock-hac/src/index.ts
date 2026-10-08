import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import {
  analyzeImpex,
  runGroovy,
  runQuery,
  type ImpexVerdict,
  type MockHacData,
  defaultData,
} from './fake-instance.ts';

export interface MockHacOptions {
  /** Context path of the mocked hAC. Real instances use "/hac". */
  contextPath?: string;
  username?: string;
  password?: string;
  data?: MockHacData;
  /** Serve HTTPS with this key/certificate pair (tests for TLS handling). */
  tls?: { key: string; cert: string };
}

export type MockHacServer = Server & {
  /** Forget all sessions, like a server restart or session timeout. */
  expireSessions(): void;
  /** Number of POST requests rejected with 405 so far. */
  readonly rejectedCount: number;
  /** Queries (FlexibleSearch or SQL text) received by the console, in order. */
  readonly receivedQueries: string[];
};

interface Session {
  csrf: string;
  authenticated: boolean;
}

const COOKIE = 'JSESSIONID';
const CONSOLE_PAGES = [
  '/console/flexsearch',
  '/console/scripting',
  '/console/impex/import',
  '/platform/pkanalyzer',
];

/**
 * Deterministic stand-in for the hAC. Behaviour follows docs/hac-api.md (observed contract):
 *   login with CSRF, console pages carrying the `_csrf` meta tag, JSON endpoints guarded by
 *   `X-CSRF-TOKEN` (HTTP 405 when token/session is missing), and the HTML-result ImpEx endpoints.
 * Plain HTTP on purpose: TLS handling is covered separately in the hAC client tests.
 */
export function createMockHac(options: MockHacOptions = {}): MockHacServer {
  const ctx = options.contextPath ?? '/hac';
  const username = options.username ?? 'mock-user';
  const password = options.password ?? 'mock-pass';
  const data = options.data ?? defaultData;
  const sessions = new Map<string, Session>();
  const loggers = new Map<string, string>([
    ['root', 'WARN'],
    ['de.hybris.platform', 'INFO'],
  ]);
  let rejected = 0;
  const receivedQueries: string[] = [];

  const newToken = (): string => randomBytes(24).toString('base64url');

  function lookup(req: IncomingMessage): Session | undefined {
    const id = parseCookies(req.headers.cookie)[COOKIE];
    return id ? sessions.get(id) : undefined;
  }

  function sessionOf(req: IncomingMessage, res: ServerResponse): Session {
    const existing = lookup(req);
    if (existing) return existing;
    const created: Session = { csrf: newToken(), authenticated: false };
    const newId = newToken();
    sessions.set(newId, created);
    res.setHeader('Set-Cookie', `${COOKIE}=${newId}; Path=${ctx}; HttpOnly`);
    return created;
  }

  /** The real hAC answers 405 for POSTs without a valid session + CSRF token. */
  function guarded(req: IncomingMessage, res: ServerResponse): Session | undefined {
    const session = lookup(req);
    const token = req.headers['x-csrf-token'];
    if (!session?.authenticated || token !== session.csrf) {
      rejected++;
      res.statusCode = 405;
      res.end();
      return undefined;
    }
    return session;
  }

  const listener: RequestListener = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const path = url.pathname;
    if (!path.startsWith(ctx)) return notFound(res);
    const route = path.slice(ctx.length) || '/';

    if (req.method === 'GET' && (route === '/login' || route === '/login.jsp')) {
      return html(res, 200, loginPage(sessionOf(req, res).csrf, ctx));
    }

    if (req.method === 'POST' && route === '/j_spring_security_check') {
      const session = sessionOf(req, res);
      const form = new URLSearchParams(await readBody(req));
      const ok =
        form.get('_csrf') === session.csrf &&
        form.get('j_username') === username &&
        form.get('j_password') === password;
      if (ok) {
        session.authenticated = true;
        session.csrf = newToken(); // the real hAC rotates the token after login
        return redirect(res, `${ctx}/`);
      }
      return redirect(res, `${ctx}/login?error=true`);
    }

    if (req.method === 'GET' && (route === '/' || CONSOLE_PAGES.includes(route))) {
      const session = sessionOf(req, res);
      if (!session.authenticated) return redirect(res, `${ctx}/login`);
      return html(res, 200, page(session.csrf, route));
    }

    if (req.method === 'POST' && route === '/console/flexsearch/execute') {
      if (!guarded(req, res)) return;
      const form = new URLSearchParams(await readBody(req));
      receivedQueries.push(form.get('flexibleSearchQuery') || form.get('sqlQuery') || '');
      return json(res, runQuery(data, form));
    }

    if (req.method === 'POST' && route === '/console/scripting/execute') {
      if (!guarded(req, res)) return;
      const form = new URLSearchParams(await readBody(req));
      return json(res, runGroovy(form.get('script') ?? ''));
    }

    if (
      req.method === 'POST' &&
      (route === '/console/impex/import/validate' || route === '/console/impex/import')
    ) {
      const session = guarded(req, res);
      if (!session) return;
      const form = new URLSearchParams(await readBody(req));
      const verdict = analyzeImpex(data, form.get('scriptContent') ?? '');
      return html(res, 200, impexResultPage(session.csrf, route.endsWith('/validate'), verdict));
    }

    if (req.method === 'POST' && route === '/platform/pkanalyzer/analyze') {
      if (!guarded(req, res)) return;
      const form = new URLSearchParams(await readBody(req));
      return json(res, { pkString: form.get('pkString') ?? '', possibleException: null });
    }

    if (req.method === 'GET' && route === '/platform/log4j') {
      const session = sessionOf(req, res);
      if (!session.authenticated) return redirect(res, `${ctx}/login`);
      return html(res, 200, log4jPage(session.csrf, loggers));
    }

    if (req.method === 'POST' && route === '/platform/log4j/changeLevel') {
      if (!guarded(req, res)) return;
      const form = new URLSearchParams(await readBody(req));
      const name = form.get('loggerName') ?? '';
      const level = form.get('levelName') ?? '';
      loggers.set(name, level);
      return json(res, { loggerName: name, levelName: level, levels: [], loggers: [] });
    }

    notFound(res);
  };

  const server = (
    options.tls
      ? createHttpsServer({ key: options.tls.key, cert: options.tls.cert }, listener)
      : createServer(listener)
  ) as MockHacServer;
  server.expireSessions = () => sessions.clear();
  Object.defineProperty(server, 'rejectedCount', { get: () => rejected });
  Object.defineProperty(server, 'receivedQueries', { get: () => receivedQueries });
  return server;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function html(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(body);
}

function json(res: ServerResponse, body: unknown): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json;charset=UTF-8');
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.end('Not Found');
}

const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');

function head(csrf: string, title: string): string {
  return `<!doctype html><html><head><title>${title}</title>
<meta name="_csrf_parameter" content="_csrf" /><meta name="_csrf_header" content="X-CSRF-TOKEN" /><meta name="_csrf" content="${csrf}" />
</head>`;
}

function loginPage(csrf: string, ctx: string): string {
  return `${head(csrf, 'mock administration console - login')}<body>
<form action="${ctx}/j_spring_security_check" method="POST" autocomplete="off">
<input type="text" name="j_username"/><input type="password" name="j_password" value=""/>
<input type="hidden" name="_csrf" value="${csrf}" />
</form></body></html>`;
}

function page(csrf: string, route: string): string {
  return `${head(csrf, 'mock administration console')}<body>mock hAC ${route}</body></html>`;
}

function impexResultPage(csrf: string, validateOnly: boolean, verdict: ImpexVerdict): string {
  const id = validateOnly ? 'validationResultMsg' : 'impexResult';
  const details =
    !validateOnly && !verdict.ok
      ? `<div class="box impexResult quiet"><pre>\n# ${escapeAttr(verdict.message)}\n</pre></div>`
      : '';
  const message = validateOnly
    ? verdict.ok
      ? 'Import script is valid'
      : `Import script is invalid: ${verdict.message}`
    : verdict.ok
      ? 'Import finished successfully'
      : `Import has encountered problems: ${verdict.message}`;
  return `${head(csrf, 'mock administration console - impex')}<body>
<span id="${id}" data-level="${verdict.ok ? 'notice' : 'error'}"
      data-result="${escapeAttr(message)}"></span>${details}</body></html>`;
}

function log4jPage(csrf: string, loggers: Map<string, string>): string {
  const levels = ['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'OFF'];
  const rows = [...loggers]
    .map(([name, level]) => {
      const options = levels
        .map(
          (l) => `<option value="${l}"${l === level ? ' selected="selected"' : ''}>${l}</option>`,
        )
        .join('');
      return `<tr><td title="${escapeAttr(name)}">${escapeAttr(name)}</td><td title=""></td><td><select class="loggerLevels" data-loggerName="${escapeAttr(name)}">${options}</select></td></tr>`;
    })
    .join('\n');
  return `${head(csrf, 'mock administration console - log4j')}<body>
<table id="loggers" class="stripe cell-border" data-changeLoggerLevelUrl="/hac/platform/log4j/changeLevel">
<thead><tr><th>Logger</th><th>Parent Logger</th><th>Effective Level</th></tr></thead>
<tbody>
${rows}
</tbody></table></body></html>`;
}
