// v2 contracts §2, §3: the one name grammar. A type, a fragment, a vocabulary,
// a vocabulary entry, a rule id, a library id and a bundle label are all
// lower-case letters and digits in hyphen-separated runs (the Agent Skills
// name grammar the old `label` already used).

export const NAME_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** A label is also a skill name, which caps it at 64 characters. */
export const LABEL_MAX = 64;

export function isName(text: string): boolean {
  return NAME.test(text);
}

/**
 * A name as written in a document: bare (`planting`) or qualified by a library
 * id (`garden/planting`). `undefined` when it is neither.
 */
export function splitName(text: string): { library?: string; name: string } | undefined {
  const slash = text.indexOf("/");
  if (slash < 0) return isName(text) ? { name: text } : undefined;
  const library = text.slice(0, slash);
  const name = text.slice(slash + 1);
  if (!isName(library) || !isName(name)) return undefined;
  return { library, name };
}

/** The qualified name of `name` declared in `namespace` (`""` is the bundle's own, bare). */
export function qualify(namespace: string, name: string): string {
  return namespace === "" ? name : `${namespace}/${name}`;
}

/**
 * A reference written inside a document of `namespace`, as the qualified name
 * it denotes: a bare name is the document's own namespace's, a qualified name
 * is the library's it names.
 */
export function resolveReference(namespace: string, written: string): string | undefined {
  const split = splitName(written);
  if (split === undefined) return undefined;
  return split.library === undefined ? qualify(namespace, split.name) : written;
}
