/** Removes secrets from text that may end up in logs or notifications. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 3) out = out.split(secret).join('***');
  }
  return out
    .replace(/(j_password=)[^&\s]+/gi, '$1***')
    .replace(/(X-CSRF-TOKEN["']?\s*[:=]\s*["']?)[\w-]{16,}/gi, '$1***');
}
