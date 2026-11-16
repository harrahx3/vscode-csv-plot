/** Turns the cells of one worksheet (one table per sheet) into typed columns. */
import {
  columnNames,
  KIND_THRESHOLD,
  maxAbs,
  type Column,
  type ColumnKind,
  type Table,
} from "./table";
import { detectDateOrder, hasOffset, isMissing, parseTimestamp, type DateOrder } from "./values";
import type { Cell } from "./workbook";

/** Rows looked at to find where the table starts (title lines above it are skipped). */
const HEADER_SEARCH_ROWS = 20;
const ORDER_SAMPLE = 1000;
const NOT_APPLICABLE = { value: "", confident: true };

export function tableFromSheet(sparseRows: (Cell[] | undefined)[]): Table {
  const filled = (r: number) => (sparseRows[r] ?? []).filter((c) => !isEmpty(c)).length;
  const used: number[] = [];
  for (let r = 0; r < sparseRows.length; r++) if (filled(r) > 0) used.push(r);
  if (used.length === 0) {
    return {
      columns: [],
      rowCount: 0,
      separator: NOT_APPLICABLE,
      decimal: NOT_APPLICABLE,
      hasHeader: false,
    };
  }

  // The table starts at the first row filled at least half as much as the widest row near the
  // top: a title or a note above the table fills a single cell.
  const top = used.slice(0, HEADER_SEARCH_ROWS);
  const widest = Math.max(...top.map(filled));
  const start = top.find((r) => filled(r) * 2 >= widest)!;
  const last = used[used.length - 1];
  const rows: Cell[][] = [];
  for (let r = start; r <= last; r++) rows.push(sparseRows[r] ?? []);

  // Columns holding at least one value, in sheet order.
  let width = 0;
  for (const r of rows) width = Math.max(width, r.length);
  const cols: number[] = [];
  for (let c = 0; c < width; c++) if (rows.some((r) => !isEmpty(r[c]))) cols.push(c);

  const first = rows[0];
  const hasHeader = !cols.every((c) => !isEmpty(first[c]) && isDataLike(first[c]));
  const data = hasHeader ? rows.slice(1) : rows;
  const names = columnNames(
    hasHeader ? cols.map((c) => cellText(first[c] ?? null)) : [],
    cols.length,
  );

  const columns = cols.map((c, index): Column => {
    const cells = data.map((r) => r[c] ?? null);
    const { kind, order } = planColumn(cells);
    if (kind === "text") return { name: names[index], index, kind, values: cells.map(cellText) };
    const values = Float64Array.from(cells, (cell) =>
      kind === "number" ? cellNumber(cell) : cellTime(cell, order),
    );
    const offset =
      kind === "time" && cells.some((cell) => typeof cell === "string" && hasOffset(cell));
    return { name: names[index], index, kind, values, maxAbs: maxAbs(values), hasOffset: offset };
  });
  return {
    columns,
    rowCount: data.length,
    separator: NOT_APPLICABLE,
    decimal: NOT_APPLICABLE,
    hasHeader,
  };
}

function planColumn(cells: Cell[]): { kind: ColumnKind; order: DateOrder | null } {
  const values = cells.filter((c) => !isEmpty(c));
  if (values.length === 0) return { kind: "number", order: null };
  const numbers = values.filter((c) => !Number.isNaN(cellNumber(c))).length;
  if (numbers / values.length >= KIND_THRESHOLD) return { kind: "number", order: null };
  // Dates typed as text in the sheet are read like in a CSV file.
  const strings = values.filter((c): c is string => typeof c === "string");
  const order = strings.length
    ? detectDateOrder(strings.slice(0, ORDER_SAMPLE), KIND_THRESHOLD)
    : null;
  const times = values.filter((c) => !Number.isNaN(cellTime(c, order))).length;
  if (times / values.length >= KIND_THRESHOLD) return { kind: "time", order };
  return { kind: "text", order: null };
}

function isEmpty(cell: Cell | undefined): boolean {
  return cell === null || cell === undefined || (typeof cell === "string" && isMissing(cell));
}

/** A value that would not appear in a header row: a number, a date, a boolean. */
function isDataLike(cell: Cell | undefined): boolean {
  if (cell === null || cell === undefined) return false;
  if (typeof cell !== "string") return true;
  return !Number.isNaN(numberFromText(cell)) || detectDateOrder([cell], 1) !== null;
}

function cellNumber(cell: Cell): number {
  if (typeof cell === "number") return cell;
  if (typeof cell === "boolean") return cell ? 1 : 0;
  if (typeof cell === "string") return numberFromText(cell);
  return NaN;
}

/** Number stored as text, with a dot or a comma as decimal mark. */
function numberFromText(raw: string): number {
  const s = raw.trim();
  if (s === "") return NaN;
  const value = Number(/^[+-]?\d*,\d+$/.test(s) ? s.replace(",", ".") : s);
  return Number.isFinite(value) ? value : NaN;
}

function cellTime(cell: Cell, order: DateOrder | null): number {
  if (cell !== null && typeof cell === "object") return cell.ms;
  if (typeof cell === "string" && order) return parseTimestamp(cell, order);
  return NaN;
}

function cellText(cell: Cell): string {
  if (cell === null) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  if (typeof cell === "number") return String(cell);
  return new Date(cell.ms)
    .toISOString()
    .replace("T", " ")
    .replace(/(:00)?\.000Z$/, "");
}
