/** Turns CSV text into typed columns (numbers, timestamps, text). */
import { detectDecimal, detectSeparator, type Detection } from "./detect";
import { countLinesUpperBound, forEachRow } from "./tokenize";
import {
  detectDateOrder,
  hasOffset,
  isMissing,
  parseNumber,
  parseTimestamp,
  type DateOrder,
} from "./values";

export type ColumnKind = "number" | "time" | "text";

interface ColumnBase {
  name: string;
  /** Position of the column in the file (0-based). */
  index: number;
}
export interface NumericColumn extends ColumnBase {
  kind: "number" | "time";
  /** Numbers, or epoch milliseconds for timestamps; NaN for missing cells. */
  values: Float64Array;
  /** Largest absolute finite value (0 if none). */
  maxAbs: number;
  /** Timestamp columns only: at least one value carries an explicit UTC offset. */
  hasOffset: boolean;
}
export interface TextColumn extends ColumnBase {
  kind: "text";
  values: string[];
}
export type Column = NumericColumn | TextColumn;

export interface Table {
  columns: Column[];
  rowCount: number;
  separator: Detection;
  decimal: Detection;
  hasHeader: boolean;
}

export interface ParseOptions {
  /** Forced separator; detected when omitted. */
  separator?: string;
  /** Forced decimal mark; detected when omitted. */
  decimal?: string;
}

const SAMPLE_ROWS = 1000;
export const KIND_THRESHOLD = 0.95;

export function parseTable(text: string, options: ParseOptions = {}): Table {
  const separator: Detection = options.separator
    ? { value: options.separator, confident: true }
    : detectSeparator(text);
  const sep = separator.value;

  const sample: string[][] = [];
  forEachRow(text, sep, (fields) => void sample.push(fields.slice()), SAMPLE_ROWS + 1);
  if (sample.length === 0) {
    return {
      columns: [],
      rowCount: 0,
      separator,
      decimal: { value: ".", confident: true },
      hasHeader: false,
    };
  }

  const decimal: Detection = options.decimal
    ? { value: options.decimal, confident: true }
    : detectDecimal(sep, sample.slice(1).flat());
  const dec = decimal.value;

  const first = sample[0];
  const looksLikeData = first.every(
    (f) =>
      !isMissing(f) && (!Number.isNaN(parseNumber(f, dec)) || detectDateOrder([f], 1) !== null),
  );
  const hasHeader = !looksLikeData;
  const dataSample = hasHeader ? sample.slice(1) : sample;
  const width = hasHeader ? first.length : Math.max(...sample.map((r) => r.length));
  const names = columnNames(hasHeader ? first : [], width);

  const plans = names.map((name, index) => planColumn(name, index, dataSample, dec));
  const capacity = countLinesUpperBound(text);
  const numeric = plans.map((p) => (p.kind === "text" ? null : new Float64Array(capacity)));
  const texts = plans.map((p) => (p.kind === "text" ? ([] as string[]) : null));

  let rowCount = 0;
  forEachRow(text, sep, (fields, rowIndex) => {
    if (hasHeader && rowIndex === 0) return;
    for (let c = 0; c < width; c++) {
      const raw = fields[c] ?? "";
      const plan = plans[c];
      if (plan.kind === "text") texts[c]!.push(raw);
      else if (plan.kind === "number") numeric[c]![rowCount] = parseNumber(raw, dec);
      else numeric[c]![rowCount] = parseTimestamp(raw, plan.order!);
    }
    rowCount++;
  });

  const columns: Column[] = plans.map((plan, c) => {
    if (plan.kind === "text") return { name: plan.name, index: c, kind: "text", values: texts[c]! };
    const values = numeric[c]!.slice(0, rowCount);
    return {
      name: plan.name,
      index: c,
      kind: plan.kind,
      values,
      maxAbs: maxAbs(values),
      hasOffset: plan.hasOffset,
    };
  });
  return { columns, rowCount, separator, decimal, hasHeader };
}

interface ColumnPlan {
  name: string;
  kind: ColumnKind;
  order?: DateOrder;
  hasOffset: boolean;
}

function planColumn(name: string, index: number, rows: string[][], dec: string): ColumnPlan {
  const values = rows.map((r) => r[index] ?? "").filter((v) => !isMissing(v));
  if (values.length === 0) return { name, kind: "number", hasOffset: false };
  const numbers = values.filter((v) => !Number.isNaN(parseNumber(v, dec))).length;
  if (numbers / values.length >= KIND_THRESHOLD) return { name, kind: "number", hasOffset: false };
  const order = detectDateOrder(values, KIND_THRESHOLD);
  if (order) return { name, kind: "time", order, hasOffset: values.some(hasOffset) };
  return { name, kind: "text", hasOffset: false };
}

/** Header names, trimmed; blanks become colN and duplicates get a " (2)" suffix. */
export function columnNames(header: string[], width: number): string[] {
  const seen = new Map<string, number>();
  const names: string[] = [];
  for (let i = 0; i < width; i++) {
    let name = (header[i] ?? "").trim() || `col${i + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count > 0) name = `${name} (${count + 1})`;
    names.push(name);
  }
  return names;
}

export function maxAbs(values: Float64Array): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    const a = Math.abs(values[i]);
    if (a > max) max = a;
  }
  return max;
}
