/** The date every test's spawned CLI stamps: pinned through `WIKIWRIGHT_TODAY`, so no page carries the wall clock. */
export const TODAY = "2026-09-04";

/** Spread into a spawn's `env` beside `process.env`. */
export const PINNED_CLOCK = { WIKIWRIGHT_TODAY: TODAY } as const;
