// docs/architecture.md §Directories: the page name a path carries, with the
// `.md` off. It sat in `names/index.ts`, which the field resolver imports for
// it while `names/index.ts` imports the field resolver back — a cycle whose
// whole content was this function. It depends on nothing.
export function basenameOf(path: string): string {
  const file = path.split("/").at(-1) ?? path;
  return file.endsWith(".md") ? file.slice(0, -3) : file;
}
