// v2 contracts §2 (a library path resolves against the git top level and must
// stay inside the repository) · §7 (digest lines are sorted by UTF-8 bytes).
//
// String arithmetic only: the kernel decides what a declared path spells and
// whether it leaves the repository lexically; whether a directory on disk is a
// link that leaves it is the shell's question (packages/cli/src/lawfiles.ts).

/**
 * A repository-relative path with `.` and `..` resolved, or `undefined` when it
 * is absolute, drive-qualified, carries a backslash or a control character, or
 * climbs above the top level. `""` is the top level itself.
 */
export function resolveInRepository(path: string): string | undefined {
  if (path.startsWith("/") || /^[A-Za-z]:/u.test(path) || path.includes("\\")) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (/[\u0000-\u001f\u007f]/u.test(path)) return undefined;
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return undefined;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/** `a/b` joined under `prefix` (`""` is the top level). */
export function joinUnder(prefix: string, rel: string): string {
  if (prefix === "") return rel;
  if (rel === "") return prefix;
  return `${prefix}/${rel}`;
}

/** `path` relative to `prefix`, or `undefined` when it does not lie under it. */
export function relativeUnder(prefix: string, path: string): string | undefined {
  if (prefix === "") return path;
  if (!path.startsWith(`${prefix}/`)) return undefined;
  return path.slice(prefix.length + 1);
}

/**
 * Order by UTF-8 bytes, which is order by code point: a surrogate pair sorts
 * after every BMP character, where code-unit order puts it before U+E000..U+FFFF.
 */
export function utf8Compare(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const na = ia.next();
    const nb = ib.next();
    if (na.done === true) return nb.done === true ? 0 : -1;
    if (nb.done === true) return 1;
    const ca = na.value.codePointAt(0) ?? 0;
    const cb = nb.value.codePointAt(0) ?? 0;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
}
