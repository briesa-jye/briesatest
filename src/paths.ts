/**
 * Match a dot-separated path against a pattern.
 * `*` matches exactly one segment; `**` matches any remaining segments.
 */
export function matchPath(pattern: string, path: string): boolean {
  const p = pattern.split(".");
  const s = path.split(".");
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "**") return true;
    if (i >= s.length) return false;
    if (p[i] !== "*" && p[i] !== s[i]) return false;
  }
  return p.length === s.length;
}
