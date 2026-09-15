#!/usr/bin/env node
// The `wikiwright` executable. It asks Node to keep a compile cache of the
// engine's own JavaScript, then loads the engine. ES module imports are
// resolved before a module's body runs, so the cache is switched on here, one
// module ahead of `main.ts`; switched on inside `main.ts`, nothing it imports
// would be cached. The cache holds V8 bytecode keyed by the source it was
// compiled from, under the operating system's temporary directory. It cannot
// change what a verb decides, only how long the engine takes to load, and
// NODE_DISABLE_COMPILE_CACHE=1 turns it off. Bun keeps no such cache and
// skips the call.
import module from "node:module";

module.enableCompileCache?.();
await import("./main.ts");
