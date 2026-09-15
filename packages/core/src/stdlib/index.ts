// docs/extending.md §What a module registers (the standard library: three optional modules registering
// through the API a kit uses) · docs/architecture.md §The invariants
//
// The composition point, and the ONLY module under `stdlib/` the world outside
// it imports. The kernel never reaches for this file: a registry is handed to it
// (`docs/architecture.md §How a verdict is produced`, `Law.modules`), which is what makes the standard library a layer
// rather than a directory.
import { loadModules, type ModuleManifest, type ModuleRegistry } from "../modules/index.ts";
import claims from "./claims.ts";
import entries from "./entries.ts";
import relations from "./relations.ts";

/** The three first-party manifests, in load order. */
export const STANDARD_LIBRARY: readonly ModuleManifest[] = [claims, relations, entries];

/**
 * docs/extending.md §What a module registers: the registry a bundle gets when it declares the standard library.
 * A collision here is an engine defect rather than a bundle's, because these are
 * the modules the engine ships — so it throws rather than returning issues a
 * bundle author could act on.
 */
export function standardLibrary(): ModuleRegistry {
  const loaded = loadModules(STANDARD_LIBRARY);
  if (!loaded.ok) {
    const names = loaded.conflicts.map((c) => `${c.kind} "${c.id}"`).join(", ");
    throw new Error(`the shipped standard library collides with itself: ${names}`);
  }
  return loaded.registry;
}
