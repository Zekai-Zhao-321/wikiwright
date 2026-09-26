// A page as search reads it: its path and its parse. The vault's names —
// basenames, aliases and titles, every comparison through normalizeIdentity —
// are the judge's (verdict/names.ts); the old name index and its identity
// check left with the old registry in step 6.
import type { ParsedDoc } from "../parse/index.ts";
import { basenameOf } from "./basename.ts";

export interface NamedPage {
  path: string;
  doc: ParsedDoc;
}

export { basenameOf };
