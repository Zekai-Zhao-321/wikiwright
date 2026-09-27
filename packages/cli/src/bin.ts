#!/usr/bin/env bun
// The `wikiwright` executable: the engine under Bun, the one runtime it runs
// on (`.bun-version`). It loads the engine and nothing else; the JSON
// envelope is `main.ts`'s.
await import("./main.ts");
