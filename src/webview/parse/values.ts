/** Parsing of individual cell values: numbers (with either decimal mark), missing markers, timestamps. */

const MISSING = new Set(["", "na", "n/a", "nan", "null", "none", "-", "#n/a"]);

/** True for an empty cell or a conventional "no value" marker. */
export function isMissing(raw: string): boolean {
  const s = raw.trim();
  return s.length <= 4 && MISSING.has(s.toLowerCase());
}

/** Parses a number written with `decimal` as decimal mark; NaN when not a finite number. */
export function parseNumber(raw: string, decimal: string): number {
  let s = raw.trim();
  if (s === "") return NaN;
  if (decimal === ",") s = s.replace(",", ".");
  const value = Number(s);
  return Number.isFinite(value) ? value : NaN;
}

export type DateOrder = "ymd" | "dmy" | "mdy";

const TIME_PART = String.raw`(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?`;
const OFFSET_PART = String.raw`\s*(Z|[+-]\d{2}(?::?\d{2})?)?`;
/** 2020-01-31, 2020/01/31, with optional time and offset. */
const YMD = new RegExp(
  String.raw`^(\d{4})[-/](\d{1,2})[-/](\d{1,2})${TIME_PART}${OFFSET_PART}$`,
  "i",
);
/** 31/01/2020, 31.01.2020, 01-31-2020, with optional time and offset. */
const XXY = new RegExp(
  String.raw`^(\d{1,2})[./-](\d{1,2})[./-](\d{4})${TIME_PART}${OFFSET_PART}$`,
  "i",
);

/**
 * Parses a timestamp to milliseconds since the epoch. A timestamp without an offset is
 * read as UTC, so it is displayed exactly as written (no daylight-saving shifts).
 * Returns NaN when the text is not a valid timestamp in the given order.
 */
export function parseTimestamp(raw: string, order: DateOrder): number {
  const s = raw.trim();
  const m = (order === "ymd" ? YMD : XXY).exec(s);
  if (!m) return NaN;
  let year: number, month: number, day: number;
  if (order === "ymd") [year, month, day] = [+m[1], +m[2], +m[3]];
  else if (order === "dmy") [day, month, year] = [+m[1], +m[2], +m[3]];
  else [month, day, year] = [+m[1], +m[2], +m[3]];
  if (month < 1 || month > 12 || day < 1 || day > 31) return NaN;
  const hour = m[4] ? +m[4] : 0;
  const minute = m[5] ? +m[5] : 0;
  const second = m[6] ? +m[6] : 0;
  if (hour > 24 || minute > 59 || second > 60) return NaN;
  const millis = m[7] ? Math.round(+`0.${m[7]}` * 1000) : 0;
  let ms = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  if (m[8]) ms -= offsetMinutes(m[8]) * 60_000;
  return ms;
}

function offsetMinutes(offset: string): number {
  if (offset.toUpperCase() === "Z") return 0;
  const sign = offset[0] === "-" ? -1 : 1;
  const digits = offset.slice(1).replace(":", "");
  const hours = +digits.slice(0, 2);
  const minutes = digits.length > 2 ? +digits.slice(2) : 0;
  return sign * (hours * 60 + minutes);
}

/** True when the timestamp text carries an explicit offset (Z or ±hh:mm). */
export function hasOffset(raw: string): boolean {
  return /(Z|[+-]\d{2}(:?\d{2})?)$/i.test(raw.trim()) && /\d[T ]+\d/.test(raw.trim());
}

/**
 * Decides whether non-missing sample values form a timestamp column and in which date order.
 * Requires at least `threshold` of them to parse. Day-first is assumed when ambiguous.
 */
export function detectDateOrder(sample: string[], threshold = 0.95): DateOrder | null {
  if (sample.length === 0) return null;
  const okShare = (order: DateOrder) =>
    sample.filter((v) => !Number.isNaN(parseTimestamp(v, order))).length / sample.length;
  if (okShare("ymd") >= threshold) return "ymd";
  if (!sample.some((v) => XXY.test(v.trim()))) return null;
  let firstOver12 = false;
  let secondOver12 = false;
  for (const v of sample) {
    const m = XXY.exec(v.trim());
    if (!m) continue;
    if (+m[1] > 12) firstOver12 = true;
    if (+m[2] > 12) secondOver12 = true;
  }
  const order: DateOrder = secondOver12 && !firstOver12 ? "mdy" : "dmy";
  return okShare(order) >= threshold ? order : null;
}
