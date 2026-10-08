/** Base class for everything the hAC client throws. Messages never contain credentials. */
export class HacError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Network level failure: unreachable host, TLS problem, timeout, aborted. */
export class HacConnectionError extends HacError {
  constructor(
    message: string,
    readonly code?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Login failed, or the session/CSRF token could not be (re-)established. */
export class HacAuthError extends HacError {}

/** The hAC answered, but not in the shape this client understands. */
export class HacProtocolError extends HacError {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** A query/script was executed and the server reported a failure. */
export class HacQueryError extends HacError {
  constructor(
    message: string,
    /** Message of the deepest cause, often the most useful one. */
    readonly rootCause: string,
    readonly stackTrace: string,
  ) {
    super(message);
  }
}
