/**
 * Checks a declared MIME type and file name against patterns like
 * `"image/*"`, `"application/pdf"` and `".zip"`.
 */
export function isTypeAllowed(
  patterns: readonly string[],
  type: string | undefined,
  name: string | undefined,
): boolean {
  const mime = type?.trim().toLowerCase() ?? "";
  const filename = name?.trim().toLowerCase() ?? "";

  return patterns.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    if (pattern.startsWith(".")) {
      return filename.length > pattern.length && filename.endsWith(pattern);
    }
    if (pattern.endsWith("/*")) {
      // Keep the slash so "image/*" doesn't match "imagex/png".
      const prefix = pattern.slice(0, -1);
      return mime.length > prefix.length && mime.startsWith(prefix);
    }
    return mime !== "" && mime === pattern;
  });
}
