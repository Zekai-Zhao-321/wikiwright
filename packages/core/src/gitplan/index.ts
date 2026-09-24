// docs/architecture.md (git via spawned plumbing; -z output parsed in pure core)
// docs/architecture.md §Directories (core/gitplan) · docs/constitution.md (rename detection is the former-folder-tags review's input).
export type StagedStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U";

export interface StagedChange {
  status: StagedStatus;
  path: string;
  oldPath?: string;
}

const KNOWN: ReadonlySet<string> = new Set(["A", "M", "D", "R", "C", "T", "U"]);

/** Parse `git diff --cached --name-status -z -M` output. Pure; bytes in, records out. */
export function parseNameStatusZ(raw: string): StagedChange[] {
  const parts = raw.split("\0");
  const out: StagedChange[] = [];
  let i = 0;
  while (i < parts.length) {
    const code = parts[i];
    if (code === undefined || code === "") break;
    const statusChar = code[0];
    if (statusChar === undefined || !KNOWN.has(statusChar)) {
      i += 2;
      continue;
    }
    const status = statusChar as StagedStatus; // invariant: membership checked against KNOWN above
    if (status === "R" || status === "C") {
      const oldPath = parts[i + 1];
      const path = parts[i + 2];
      if (oldPath !== undefined && path !== undefined) out.push({ status, path, oldPath });
      i += 3;
    } else {
      const path = parts[i + 1];
      if (path !== undefined) out.push({ status, path });
      i += 2;
    }
  }
  return out;
}

/**
 * One `git cat-file --batch-check` record. For an object git holds, `name` is
 * its full object id and `type` and `size` its type and byte size; for one it
 * does not, `name` is the request git echoed and `type` and `size` are
 * `undefined`.
 */
export interface BatchCheckRecord {
  name: string;
  type: string | undefined;
  size: number | undefined;
}

/**
 * Parse `git cat-file --batch-check` output: one line per name given on stdin,
 * `<oid> <type> <size>` for an object git holds and `<name> missing` for one it
 * does not. Pure; a line of neither shape is a broken pipe, thrown.
 */
export function parseCatFileBatchCheck(raw: string): BatchCheckRecord[] {
  const out: BatchCheckRecord[] = [];
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    // git echoes a name it cannot resolve, and a name may itself hold spaces.
    if (line.endsWith(" missing")) {
      out.push({ name: line.slice(0, -" missing".length), type: undefined, size: undefined });
      continue;
    }
    const parts = line.split(" ");
    const size = Number(parts[2]);
    if (parts.length !== 3 || parts[0] === undefined || !Number.isInteger(size) || size < 0) {
      throw new Error(`unreadable cat-file --batch-check line: ${JSON.stringify(line)}`);
    }
    out.push({ name: parts[0], type: parts[1], size });
  }
  return out;
}

const NEWLINE = 0x0a;

/**
 * Bytes to text, supplied by the shell: the kernel names no platform decoder
 * (`docs/architecture.md`), and the one that reads pages must keep a leading
 * U+FEFF as `Buffer#toString` does, since `normalizeInput` is where a BOM is
 * dropped, once, for every reader.
 */
export type Decode = (bytes: Uint8Array) => string;

const HEADER_BYTE_MAX = 0x7f;

/** A header line is ASCII by construction: an object id, a type and a size. */
function asciiOf(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    if (byte > HEADER_BYTE_MAX) throw new Error("cat-file --batch header is not ASCII");
    out += String.fromCharCode(byte);
  }
  return out;
}

/**
 * A `cat-file --batch` stream that stopped before its last object did: a
 * header with no newline, or fewer content bytes than the header's size. Git
 * writes every byte it announces, so this is the answer cut short, and the
 * shell refuses it as a short read by name. `object` is the object it stopped
 * inside, where a header named one.
 */
export class BatchStreamTruncated extends Error {
  readonly object: string | undefined;
  constructor(object?: string) {
    super(
      object === undefined
        ? "cat-file --batch output ends inside a header"
        : `cat-file --batch output ends inside object ${object}`,
    );
    this.object = object;
  }
}

/**
 * Parse `git cat-file --batch` output in its default format: per object a
 * header line `<oid> <type> <size>`, then exactly `<size>` bytes of content,
 * then one newline; `<name> missing` for an object git does not hold. The size
 * is in bytes, so the stream is split as bytes and each object's content is
 * decoded on its own — a page may itself hold a line shaped like a header, and
 * a multi-byte character is one character and several bytes. Pure; a stream
 * that ends inside an object is thrown as `BatchStreamTruncated`, never
 * returned as a shorter page, and one whose object runs on past its size is
 * thrown as malformed.
 */
export function parseCatFileBatch(bytes: Uint8Array, decode: Decode): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (at < bytes.length) {
    const newline = bytes.indexOf(NEWLINE, at);
    if (newline < 0) throw new BatchStreamTruncated();
    const header = asciiOf(bytes.subarray(at, newline)).split(" ");
    if (header.length === 2 && header[1] === "missing") {
      at = newline + 1;
      continue;
    }
    const name = header[0];
    const size = Number(header[2]);
    if (header.length !== 3 || name === undefined || !Number.isInteger(size) || size < 0) {
      throw new Error(`unreadable cat-file --batch header: ${JSON.stringify(header.join(" "))}`);
    }
    const start = newline + 1;
    const end = start + size;
    if (end >= bytes.length) throw new BatchStreamTruncated(name);
    if (bytes[end] !== NEWLINE) {
      throw new Error(`cat-file --batch object ${name} is not followed by a newline`);
    }
    out.set(name, decode(bytes.subarray(start, end)));
    at = end + 1;
  }
  return out;
}
