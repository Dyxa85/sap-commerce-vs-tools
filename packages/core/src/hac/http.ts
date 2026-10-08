import * as http from 'node:http';
import * as https from 'node:https';
import { HacConnectionError, HacProtocolError } from './errors.js';

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface HttpSessionOptions {
  /** Base URL including the context path, e.g. https://localhost:9002/hac */
  baseUrl: string;
  /** Skip TLS certificate verification (self-signed local instances). Off by default. */
  ignoreTlsErrors?: boolean;
  timeoutMs?: number;
  /** Responses larger than this are rejected (protects the extension host). */
  maxResponseBytes?: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  /** Sent as application/x-www-form-urlencoded. */
  form?: URLSearchParams;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Minimal cookie-aware HTTP client without redirect following (the hAC login flow needs to see the redirects).
 * Built on node:http(s) so TLS verification can be disabled per connection without a global switch.
 */
export class HttpSession {
  readonly base: URL;
  private readonly cookies = new Map<string, string>();
  private readonly agent: http.Agent;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(options: HttpSessionOptions) {
    this.base = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    if (this.base.protocol !== 'http:' && this.base.protocol !== 'https:') {
      throw new HacProtocolError(`Unsupported URL scheme: ${this.base.protocol}`);
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_BYTES;
    this.agent =
      this.base.protocol === 'https:'
        ? new https.Agent({ keepAlive: true, rejectUnauthorized: !options.ignoreTlsErrors })
        : new http.Agent({ keepAlive: true });
  }

  /** Resolve a path relative to the context path ("/login" -> {base}/login). */
  resolve(path: string): URL {
    return new URL(path.replace(/^\//, ''), this.base);
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  dispose(): void {
    this.agent.destroy();
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions = {},
  ): Promise<HttpResponse> {
    const url = this.resolve(path);
    const body = options.form?.toString();
    const headers: Record<string, string> = { Accept: '*/*', ...options.headers };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }

    const response = await this.send(url, method, headers, body, options.signal);
    this.storeCookies(response.headers['set-cookie']);
    return response;
  }

  private send(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<HttpResponse> {
    const transport = url.protocol === 'https:' ? https : http;
    return new Promise<HttpResponse>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new HacConnectionError('Request was cancelled', 'ABORTED'));
        return;
      }
      const req = transport.request(
        url,
        { method, headers, agent: this.agent, timeout: this.timeoutMs },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > this.maxBytes) {
              req.destroy(new HacProtocolError('Response exceeds the maximum allowed size'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
          res.on('error', (err) => reject(this.wrap(err, url)));
        },
      );
      const onAbort = (): void => {
        req.destroy(new HacConnectionError('Request was cancelled', 'ABORTED'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      req.on('timeout', () => {
        req.destroy(new HacConnectionError(`Timeout after ${this.timeoutMs} ms`, 'ETIMEDOUT'));
      });
      req.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(this.wrap(err, url));
      });
      req.on('close', () => signal?.removeEventListener('abort', onAbort));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  private wrap(err: Error, url: URL): Error {
    if (err instanceof HacConnectionError || err instanceof HacProtocolError) return err;
    const code = (err as NodeJS.ErrnoException).code;
    const host = `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
    const hint =
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      code === 'CERT_HAS_EXPIRED'
        ? ' (TLS certificate not trusted – enable "ignore TLS errors" for this connection only if you trust the host)'
        : '';
    return new HacConnectionError(`Cannot reach ${host}: ${code ?? err.message}${hint}`, code, {
      cause: err,
    });
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private storeCookies(setCookie: string[] | undefined): void {
    for (const line of setCookie ?? []) {
      const [pair = '', ...attrs] = line.split(';');
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a));
      if (value === '' || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}
