/**
 * Excel workbooks: the common model of the .xlsx/.xlsm reader (xlsx.ts) and the legacy .xls
 * reader (xls.ts). A formula cell always gives the result Excel saved with the file; nothing is
 * recalculated.
 */

/** A date/time cell, in milliseconds since the epoch, read as UTC (shown exactly as in Excel). */
export interface TimeCell {
  ms: number;
}
/** Value of a cell; null for an empty cell or an error such as #N/A or #DIV/0!. */
export type Cell = number | string | boolean | TimeCell | null;

export interface SheetInfo {
  name: string;
  hidden: boolean;
}

export interface SheetData {
  /** Rows by 0-based row number; a missing entry is an empty row. */
  rows: (Cell[] | undefined)[];
  /** Formula cells saved without a result (file written by a tool that does not calculate). */
  formulasWithoutResult: number;
}

export interface Workbook {
  /** Worksheets in tab order (chart sheets are left out). */
  sheets: SheetInfo[];
  /** Index in `sheets` of the sheet to show first: the active tab when the file was saved. */
  defaultSheet: number;
  readSheet(name: string): SheetData;
}

/**
 * Default sheet: the tab active when the file was saved (`activeTab` indexes every sheet,
 * chart sheets included), unless it is a chart or a hidden sheet; else the first visible one.
 */
export function pickDefaultSheet<T extends SheetInfo>(
  all: T[],
  worksheets: T[],
  activeTab: number,
) {
  const active = worksheets.indexOf(all[activeTab]);
  if (active >= 0 && !worksheets[active].hidden) return active;
  return Math.max(
    worksheets.findIndex((s) => !s.hidden),
    0,
  );
}

const MS_PER_DAY = 86_400_000;
/** Day 0 of Excel's 1900 date system (1899-12-30, which absorbs the 1900 leap-year bug). */
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);

/** Converts an Excel date serial number (days, with the time as fraction) to epoch milliseconds. */
export function serialToMs(serial: number, date1904: boolean): number {
  return (date1904 ? EPOCH_1904 : EPOCH_1900) + Math.round(serial * MS_PER_DAY);
}

const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 47, 50, 51, 52,
  53, 54, 55, 56, 57, 58,
]);

/**
 * True when a number format displays a date or a time of day (not an elapsed duration).
 * `code` is the format text when the file defines it, else the built-in format `id` decides.
 */
export function isDateFormat(id: number, code: string | undefined): boolean {
  if (code === undefined) return BUILTIN_DATE_FORMATS.has(id);
  let s = code
    .split(";")[0]
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "");
  if (/\[(h+|m+|s+)\]/i.test(s)) return false; // elapsed time such as [h]:mm
  s = s.replace(/\[[^\]]*\]/g, ""); // colours, locales, conditions
  return /[dmyhs]/i.test(s) && !/general/i.test(s);
}
