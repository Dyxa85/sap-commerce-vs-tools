import { HacAuthError, HacConnectionError } from '@sapcommerce-vstools/core';
import { UserCancelled, type ConnectionManager } from './manager.js';
import type { ConnectionConfig } from './model.js';
import type { Logger } from '../util/log.js';

export interface CheckResult {
  ok: boolean;
  /** Short text for a notification or the settings page. */
  message: string;
  /** The user closed the password prompt; nothing to report. */
  cancelled?: boolean;
}

/** Logs in to the hAC of `connection` and says what happened, in words a user can act on. */
export async function checkConnection(
  manager: ConnectionManager,
  connection: ConnectionConfig,
  log: Logger,
  signal?: AbortSignal,
): Promise<CheckResult> {
  try {
    await manager.clientFor(connection, signal);
    return { ok: true, message: `Connected to "${connection.name}" as ${connection.username}.` };
  } catch (err) {
    if (err instanceof UserCancelled) return { ok: false, message: 'Cancelled.', cancelled: true };
    log.error(`Connection test failed for "${connection.name}"`, err);
    const hint =
      err instanceof HacAuthError || err instanceof HacConnectionError
        ? err.message
        : 'Unexpected error – see the output channel.';
    return { ok: false, message: `Connection failed: ${hint}` };
  }
}
