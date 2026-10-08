import * as vscode from 'vscode';
import { redact } from './redact.js';

/** Output channel with log levels. Secrets registered via `addSecret` are masked in everything written. */
export class Logger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel('SAP Commerce', { log: true });
  private readonly secrets = new Set<string>();

  addSecret(secret: string): void {
    if (secret.length >= 3) this.secrets.add(secret);
  }

  info(message: string): void {
    this.channel.info(this.clean(message));
  }

  warn(message: string): void {
    this.channel.warn(this.clean(message));
  }

  error(message: string, err?: unknown): void {
    const detail = err instanceof Error ? ` – ${err.name}: ${err.message}` : '';
    this.channel.error(this.clean(message + detail));
  }

  debug(message: string): void {
    this.channel.debug(this.clean(message));
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private clean(text: string): string {
    return redact(text, [...this.secrets]);
  }
}
