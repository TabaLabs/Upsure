import type { RejectionReason, UploaderOptions } from "./types";

/**
 * Checks a MIME type and file name against patterns like `"image/*"`,
 * `"application/pdf"` and `".zip"`.
 */
export function isTypeAllowed(patterns: readonly string[], type: string, name: string): boolean {
  const mime = type.trim().toLowerCase();
  const filename = name.trim().toLowerCase();

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

/**
 * Returns why a file can't be added, or `null` when it can.
 * `fileCount` is how many files the uploader would already hold.
 */
export function validateFile(
  file: File,
  options: UploaderOptions,
  fileCount: number,
): RejectionReason | null {
  if (file.size === 0) return "empty";
  if (options.allowedTypes && !isTypeAllowed(options.allowedTypes, file.type, file.name)) {
    return "type";
  }
  if (options.maxFileSize !== undefined && file.size > options.maxFileSize) return "size";
  if (options.maxFiles !== undefined && fileCount >= options.maxFiles) return "too-many-files";
  return null;
}
