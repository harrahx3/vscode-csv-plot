/**
 * Reader for legacy Excel 97-2003 workbooks (.xls, BIFF8 records in the "Workbook" stream):
 * the list of worksheets and the values of their cells. Formula cells carry the result Excel
 * saved with the file.
 */
import {
  isDateFormat,
  pickDefaultSheet,
  serialToMs,
  type Cell,
  type SheetData,
  type Workbook,
} from "./workbook";

const R = {
  FORMULA: 0x0006,
  EOF: 0x000a,
  DATEMODE: 0x0022,
  FILEPASS: 0x002f,
  CONTINUE: 0x003c,
  WINDOW1: 0x003d,
  BOUNDSHEET: 0x0085,
  MULRK: 0x00bd,
  XF: 0x00e0,
  SST: 0x00fc,
  LABELSST: 0x00fd,
  NUMBER: 0x0203,
  LABEL: 0x0204,
  BOOLERR: 0x0205,
  STRING: 0x0207,
  RK: 0x027e,
  FORMAT: 0x041e,
  BOF: 0x0809,
} as const;
const BIFF8 = 0x0600;
const SHEET_WORKSHEET = 0;

interface BiffRecord {
  type: number;
  /** Offset of the record data in the stream. */
  start: number;
  length: number;
}

/** Iterates over the records from `offset`; stops at the end of the stream. */
function* records(view: DataView, offset: number): Generator<BiffRecord> {
  for (let pos = offset; pos + 4 <= view.byteLength;) {
    const type = view.getUint16(pos, true);
    const length = view.getUint16(pos + 2, true);
    yield { type, start: pos + 4, length: Math.min(length, view.byteLength - pos - 4) };
    pos += 4 + length;
  }
}

export function readXls(stream: Uint8Array): Workbook {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const u16 = (o: number) => view.getUint16(o, true);
  if (stream.length < 8 || u16(0) !== R.BOF) throw new Error("This .xls file looks damaged.");
  if (u16(4) !== BIFF8) {
    throw new Error(
      "This is an Excel 5.0/95 (or older) workbook, which cannot be read. Save it as .xlsx in Excel first.",
    );
  }

  let date1904 = false;
  let activeTab = 0;
  const formats = new Map<number, string>();
  const xfFormats: number[] = [];
  const all: { name: string; hidden: boolean; offset: number; worksheet: boolean }[] = [];
  let shared: string[] = [];
  const globals: BiffRecord[] = [];
  for (const r of records(view, 0)) {
    if (r.type === R.EOF) break;
    globals.push(r);
  }
  for (let i = 1; i < globals.length; i++) {
    const { type, start, length } = globals[i];
    if (type === R.FILEPASS) {
      throw new Error(
        "This workbook is password-protected and cannot be read. Save it as .xlsx in Excel first.",
      );
    } else if (type === R.DATEMODE) date1904 = u16(start) === 1;
    else if (type === R.WINDOW1) activeTab = u16(start + 10);
    else if (type === R.FORMAT) formats.set(u16(start), readString(stream, start + 2, 2).text);
    else if (type === R.XF) xfFormats.push(u16(start + 2));
    else if (type === R.BOUNDSHEET) {
      all.push({
        offset: view.getUint32(start, true),
        hidden: (stream[start + 4] & 0x03) !== 0,
        worksheet: stream[start + 5] === SHEET_WORKSHEET,
        name: readString(stream, start + 6, 1).text,
      });
    } else if (type === R.SST) {
      // The string table spans the SST record and the CONTINUE records after it.
      const segments: [number, number][] = [[start, length]];
      while (globals[i + 1]?.type === R.CONTINUE) {
        i++;
        segments.push([globals[i].start, globals[i].length]);
      }
      shared = readSst(stream, segments);
    }
  }
  return finish();

  function finish(): Workbook {
    const dateXfs = new Set<number>();
    xfFormats.forEach((fmt, xf) => {
      if (isDateFormat(fmt, formats.get(fmt))) dateXfs.add(xf);
    });
    const worksheets = all.filter((s) => s.worksheet);
    const byName = new Map(worksheets.map((s) => [s.name, s]));
    return {
      sheets: worksheets.map(({ name, hidden }) => ({ name, hidden })),
      defaultSheet: pickDefaultSheet(all, worksheets, activeTab),
      readSheet(name: string): SheetData {
        const sheet = byName.get(name);
        if (!sheet) throw new Error(`No sheet named "${name}" in this workbook.`);
        return readSheet(view, stream, sheet.offset, { shared, dateXfs, date1904 });
      },
    };
  }
}

interface SheetContext {
  shared: string[];
  dateXfs: Set<number>;
  date1904: boolean;
}

function readSheet(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  ctx: SheetContext,
): SheetData {
  const u16 = (o: number) => view.getUint16(o, true);
  const out: SheetData = { rows: [], formulasWithoutResult: 0 };
  const set = (row: number, col: number, value: Cell) => {
    (out.rows[row] ??= [])[col] = value;
  };
  const number = (value: number, xf: number): Cell =>
    ctx.dateXfs.has(xf) ? { ms: serialToMs(value, ctx.date1904) } : value;

  let depth = 0;
  /** Cell of a FORMULA whose string result follows in a STRING record. */
  let pendingString: [number, number] | null = null;
  for (const { type, start, length } of records(view, offset)) {
    if (type === R.BOF) depth++;
    else if (type === R.EOF && --depth === 0) break;
    // Records of an embedded chart (a nested BOF...EOF) are skipped.
    if (depth !== 1 || length < 6) continue;
    const row = u16(start);
    const col = u16(start + 2);
    const xf = u16(start + 4);
    switch (type) {
      case R.NUMBER:
        set(row, col, number(view.getFloat64(start + 6, true), xf));
        break;
      case R.RK:
        set(row, col, number(decodeRk(view.getInt32(start + 6, true)), xf));
        break;
      case R.MULRK: {
        const count = (length - 6) / 6;
        for (let i = 0; i < count; i++) {
          const at = start + 4 + 6 * i;
          set(row, col + i, number(decodeRk(view.getInt32(at + 2, true)), u16(at)));
        }
        break;
      }
      case R.LABELSST:
        set(row, col, ctx.shared[view.getUint32(start + 6, true)] ?? null);
        break;
      case R.LABEL:
        set(row, col, readString(bytes, start + 6, 2).text);
        break;
      case R.BOOLERR:
        set(row, col, bytes[start + 7] ? null : bytes[start + 6] !== 0);
        break;
      case R.FORMULA: {
        pendingString = null;
        if (u16(start + 12) !== 0xffff) {
          set(row, col, number(view.getFloat64(start + 6, true), xf));
          break;
        }
        const kind = bytes[start + 6];
        if (kind === 0) pendingString = [row, col];
        else if (kind === 1) set(row, col, bytes[start + 8] !== 0);
        else set(row, col, null); // 2: error, 3: empty string
        break;
      }
      case R.STRING:
        if (pendingString)
          set(pendingString[0], pendingString[1], readString(bytes, start, 2).text);
        pendingString = null;
        break;
    }
  }
  return out;
}

/** RK: a compressed number, either a 30-bit integer or the top 30 bits of a double, maybe x100. */
export function decodeRk(rk: number): number {
  let value: number;
  if (rk & 0x02) value = rk >> 2;
  else {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setUint32(4, rk & 0xfffffffc, true);
    value = buffer.getFloat64(0, true);
  }
  return rk & 0x01 ? value / 100 : value;
}

/**
 * Reads an XLUnicodeString at `offset`: character count (`countBytes` = 1 or 2 bytes), option
 * flags, then the characters (Latin-1 or UTF-16LE). Rich-text and phonetic data are skipped.
 */
function readString(bytes: Uint8Array, offset: number, countBytes: 1 | 2) {
  const count = countBytes === 1 ? bytes[offset] : bytes[offset] | (bytes[offset + 1] << 8);
  let pos = offset + countBytes;
  const flags = bytes[pos++];
  if (flags & 0x08) pos += 2;
  if (flags & 0x04) pos += 4;
  const wide = (flags & 0x01) !== 0;
  let text = "";
  for (let i = 0; i < count; i++) {
    text += String.fromCharCode(wide ? bytes[pos] | (bytes[pos + 1] << 8) : bytes[pos]);
    pos += wide ? 2 : 1;
  }
  return { text, end: pos };
}

/**
 * Reads the shared string table. Its strings run over several records: when a string's
 * characters cross into the next record, that record starts with a fresh option byte telling
 * whether the remaining characters are 1 or 2 bytes wide.
 */
function readSst(bytes: Uint8Array, segments: [start: number, length: number][]): string[] {
  let seg = 0;
  let pos = segments[0][0];
  let end = pos + segments[0][1];
  const advance = () => {
    seg++;
    if (seg >= segments.length) return false;
    [pos, end] = [segments[seg][0], segments[seg][0] + segments[seg][1]];
    return true;
  };
  const byte = (): number => {
    while (pos >= end) if (!advance()) throw new Error("Truncated string table in this .xls file.");
    return bytes[pos++];
  };
  const u16 = () => byte() | (byte() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;

  u32(); // total number of string references
  const unique = u32();
  const out: string[] = [];
  for (let i = 0; i < unique; i++) {
    if (pos >= end && !advance()) break;
    const count = u16();
    const flags = byte();
    let wide = (flags & 0x01) !== 0;
    const runs = flags & 0x08 ? u16() : 0;
    const extended = flags & 0x04 ? u32() : 0;
    const chars: number[] = [];
    while (chars.length < count) {
      if (pos >= end) {
        if (!advance()) break;
        wide = (bytes[pos++] & 0x01) !== 0;
        continue;
      }
      chars.push(wide ? byte() | (byte() << 8) : byte());
    }
    out.push(fromCharCodes(chars));
    // Formatting runs (4 bytes each) and phonetic data follow the characters.
    for (let skip = runs * 4 + extended; skip > 0; skip--) byte();
  }
  return out;
}

function fromCharCodes(codes: number[]): string {
  let s = "";
  for (let i = 0; i < codes.length; i += 8192)
    s += String.fromCharCode(...codes.slice(i, i + 8192));
  return s;
}
