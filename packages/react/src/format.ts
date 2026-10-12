const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Formats a byte count for people, e.g. `4404019` → `"4.2 MB"`. */
export function formatSize(bytes: number): string {
  let value = Math.max(bytes, 0);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Whole bytes; one decimal otherwise, without a trailing ".0".
  const text = unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${text} ${UNITS[unit]}`;
}
