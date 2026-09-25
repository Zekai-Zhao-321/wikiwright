// v2 contracts §7: the loader reads bytes (the law digest is over bytes) and
// parses text. One decoder, strict: a law file that is not UTF-8 is refused by
// name rather than read with replacement characters that no author wrote.
//
// The language's `TextDecoder` is a global of every runtime the engine runs on;
// core's `es2023` lib does not declare it, so it is declared here, for this
// module only, with the one signature the loader uses.
declare const TextDecoder: new (
  label: string,
  options: { fatal: boolean; ignoreBOM: boolean },
) => { decode(bytes: Uint8Array): string };

const DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The text of a UTF-8 file, a leading byte-order mark kept; `undefined` when the bytes are not UTF-8. */
export function utf8Text(bytes: Uint8Array): string | undefined {
  try {
    return DECODER.decode(bytes);
  } catch {
    return undefined;
  }
}

/** The text with one leading byte-order mark removed. */
export function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
