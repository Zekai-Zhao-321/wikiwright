// The shell's one clock (docs/cli.md §write). Every verb that stamps a date reads it here
// — never on a verdict: nothing the judge does reads a date the shell computed
// (docs/architecture.md §Directories). `WIKIWRIGHT_TODAY=YYYY-MM-DD` pins it, which is how a test keeps a
// write from leaving the wall clock's date on a page the next case reads.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

let read: string | undefined;

/** Today as `YYYY-MM-DD`: `WIKIWRIGHT_TODAY` when set, the wall clock otherwise. Read once per process. */
export function today(): string {
  if (read !== undefined) return read;
  const pinned = process.env["WIKIWRIGHT_TODAY"];
  if (pinned === undefined) {
    read = new Date().toISOString().slice(0, 10);
  } else if (ISO_DATE.test(pinned)) {
    read = pinned;
  } else {
    throw new Error(`WIKIWRIGHT_TODAY is not a YYYY-MM-DD date: ${JSON.stringify(pinned)}`);
  }
  return read;
}
