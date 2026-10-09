const MAX_NAME_LENGTH = 255;

/**
 * Turns a client-supplied file name into one that is safe to show or to use
 * as a file name: no directories, no control or reserved characters.
 * Returns `fallback` when nothing usable is left.
 */
export function sanitizeFileName(name: string | null | undefined, fallback: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, MAX_NAME_LENGTH);
  return cleaned === "" ? fallback : cleaned;
}
