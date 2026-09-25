// v2 contracts §3.1: `format` is asserted for exactly `date`, `date-time` and
// `uri`, by validators the engine writes (no ajv-formats), and any other
// format is `shape-invalid`. No clock, no locale: the calendar is arithmetic.

// The language's WHATWG URL parser is a global of every runtime the engine
// runs on; core's `es2023` lib does not declare it, so it is declared here,
// for this module only.
declare const URL: new (input: string) => { protocol: string; host: string; pathname: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/u;

function daysIn(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** RFC 3339 full-date: a real calendar day. */
export function isDate(text: string): boolean {
  const m = DATE.exec(text);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
}

/** RFC 3339 date-time: a real day, a clock time (a leap second admitted), an offset. */
export function isDateTime(text: string): boolean {
  const m = DATE_TIME.exec(text);
  if (m === null || !isDate(m[1] ?? "")) return false;
  const [hour, minute, second] = [Number(m[2]), Number(m[3]), Number(m[4])];
  if (hour > 23 || minute > 59 || second > 60) return false;
  if (m[5] !== undefined && (Number(m[5]) > 23 || Number(m[6]) > 59)) return false;
  return true;
}

/** An absolute URL the WHATWG parser accepts. */
export function isUri(text: string): boolean {
  return parseUrl(text) !== undefined;
}

/** §5 `page.urls`: scheme and host lower-cased, and the path, of a URL the WHATWG parser accepts. */
export function parseUrl(text: string): { scheme: string; host: string; path: string } | undefined {
  try {
    const url = new URL(text);
    return {
      scheme: url.protocol.replace(/:$/u, "").toLowerCase(),
      host: url.host.toLowerCase(),
      path: url.pathname,
    };
  } catch {
    return undefined;
  }
}

export const FORMATS: Readonly<Record<string, (text: string) => boolean>> = {
  date: isDate,
  "date-time": isDateTime,
  uri: isUri,
};
