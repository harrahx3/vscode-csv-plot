// Writes legacy Excel 97-2003 workbooks (.xls: BIFF8 records in a compound file) for the tests,
// from the same sheet specs as make-xlsx.mjs. Exercises the shared string table split over
// CONTINUE records, RK / MULRK numbers, formula results, booleans, errors and embedded charts.

import { hourlySpec } from "./make-xlsx.mjs";

/** The hourly plant workbook of make-xlsx.mjs, as .xls (numbers of the daily sheet in MULRK). */
export function hourlyXls(hours = 8760) {
  const spec = hourlySpec(hours);
  return makeXls({ ...spec, sheets: spec.sheets.map((s) => ({ ...s, mulrk: true })) });
}

/** Error codes of BOOLERR and FORMULA results. */
const ERRORS = { "#NULL!": 0, "#DIV/0!": 7, "#VALUE!": 15, "#REF!": 23, "#NAME?": 29, "#NUM!": 36, "#N/A": 42 };

/** True when a string needs 2-byte characters (anything beyond Latin-1). */
const isWide = (s) => [...s].some((ch) => ch.charCodeAt(0) > 0xff);

class Bytes {
  data = [];
  u8(v) { this.data.push(v & 0xff); return this; }
  u16(v) { return this.u8(v).u8(v >> 8); }
  u32(v) { return this.u16(v & 0xffff).u16(v >>> 16); }
  f64(v) { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v, true); for (let i = 0; i < 8; i++) this.u8(b.getUint8(i)); return this; }
  raw(arr) { for (const v of arr) this.data.push(v); return this; }
  /** XLUnicodeString: count (1 or 2 bytes), flags, then Latin-1 or UTF-16LE characters. */
  str(s, countBytes) {
    const wide = isWide(s);
    if (countBytes === 1) this.u8(s.length); else this.u16(s.length);
    this.u8(wide ? 1 : 0);
    for (const ch of s) {
      if (wide) this.u16(ch.charCodeAt(0));
      else this.u8(ch.charCodeAt(0));
    }
    return this;
  }
}

const record = (out, type, body = new Bytes()) => out.u16(type).u16(body.data.length).raw(body.data);
const bof = (dt) => new Bytes().u16(0x0600).u16(dt).u16(0x0dbb).u16(0x07cc).u32(0).u32(6);

/** RK encoding of a number, or null when it needs a full NUMBER record. */
export function encodeRk(v) {
  const fits = (n) => Number.isInteger(n) && n >= -(2 ** 29) && n < 2 ** 29;
  if (fits(v)) return ((v << 2) | 2) >>> 0;
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, v, true);
  if (b.getUint32(0, true) === 0 && (b.getUint32(4, true) & 3) === 0) return b.getUint32(4, true);
  const w = Math.round(v * 100);
  if (fits(w) && w / 100 === v) return ((w << 2) | 3) >>> 0;
  return null;
}

/**
 * @param {{ sheets: { name: string, rows?: unknown[][], hidden?: boolean, chart?: boolean,
 *   mulrk?: boolean, embeddedChart?: boolean }[], date1904?: boolean, activeTab?: number,
 *   sstChunk?: number, extraStreams?: Record<string, Uint8Array>, workbookStream?: string }} spec
 */
export function makeXls({ sheets, date1904 = false, activeTab = 0, sstChunk = 8224, extraStreams = {}, workbookStream = "Workbook" }) {
  const shared = [];
  const sharedIndex = new Map();
  const sst = (s) => {
    if (!sharedIndex.has(s)) { sharedIndex.set(s, shared.length); shared.push(s); }
    return sharedIndex.get(s);
  };
  const serial = (d) => d.getTime() / 86_400_000 + (date1904 ? 24107 : 25569);

  // Sheet substreams first: they fill the shared string table.
  const substreams = sheets.map((sheet) => {
    const out = new Bytes();
    record(out, 0x0809, bof(sheet.chart ? 0x0020 : 0x0010));
    (sheet.rows ?? []).forEach((row, r) => {
      if (!row) return;
      for (let c = 0; c < row.length; c++) {
        // A run of RK-encodable plain numbers becomes one MULRK record.
        if (sheet.mulrk && typeof row[c] === "number" && encodeRk(row[c]) !== null) {
          let end = c;
          while (typeof row[end + 1] === "number" && encodeRk(row[end + 1]) !== null) end++;
          if (end > c) {
            const body = new Bytes().u16(r).u16(c);
            for (let i = c; i <= end; i++) body.u16(0).u32(encodeRk(row[i]));
            record(out, 0x00bd, body.u16(end));
            c = end;
            continue;
          }
        }
        cellRecords(out, row[c], r, c);
      }
    });
    if (sheet.embeddedChart) {
      record(out, 0x0809, bof(0x0020));
      record(out, 0x0203, new Bytes().u16(0).u16(0).u16(0).f64(999)); // must be ignored
      record(out, 0x000a);
    }
    record(out, 0x000a);
    return out.data;
  });

  function cellRecords(out, spec, r, c) {
    const head = (xf = 0) => new Bytes().u16(r).u16(c).u16(xf);
    const num = (v, xf = 0) => {
      const rk = encodeRk(v);
      if (rk !== null) record(out, 0x027e, head(xf).u32(rk));
      else record(out, 0x0203, head(xf).f64(v));
    };
    if (spec === null || spec === undefined) return;
    if (typeof spec === "number") return num(spec);
    if (typeof spec === "boolean") return record(out, 0x0205, head().u8(spec ? 1 : 0).u8(0));
    if (typeof spec === "string") return record(out, 0x00fd, head().u32(sst(spec)));
    if (spec instanceof Date) return num(serial(spec), 2);
    if (spec.date) return num(serial(spec.date), spec.style ?? 1);
    if (spec.error) return record(out, 0x0205, head().u8(ERRORS[spec.error]).u8(1));
    if (spec.inline !== undefined) return record(out, 0x0204, head().str(spec.inline, 2));
    if (spec.f !== undefined) {
      const body = head(spec.style ?? 0);
      const special = (kind, b = 0) => body.u8(kind).u8(0).u8(b).u8(0).u8(0).u8(0).u16(0xffff);
      if (typeof spec.v === "number") body.f64(spec.v);
      else if (typeof spec.v === "string") special(0);
      else if (typeof spec.v === "boolean") special(1, spec.v ? 1 : 0);
      else special(3); // no result: empty string
      body.u16(0).u32(0).u16(3).u8(0x1e).u16(1); // formula "=1" (ptgInt)
      record(out, 0x0006, body);
      if (typeof spec.v === "string") record(out, 0x0207, new Bytes().str(spec.v, 2));
      return;
    }
    num(spec.v, spec.style ?? 0);
  }

  // Workbook globals.
  const g = new Bytes();
  record(g, 0x0809, bof(0x0005));
  record(g, 0x0042, new Bytes().u16(1200)); // CODEPAGE: UTF-16
  record(g, 0x003d, new Bytes().u16(0).u16(0).u16(10000).u16(8000).u16(0x38).u16(activeTab).u16(0).u16(1).u16(600));
  record(g, 0x0022, new Bytes().u16(date1904 ? 1 : 0));
  record(g, 0x0031, new Bytes().u16(200).u16(0).u16(0x190).u16(0).u16(0).u8(0).u8(0).u8(0).u8(0).str("Arial", 1));
  record(g, 0x041e, new Bytes().u16(164).str("yyyy\\-mm\\-dd\\ hh:mm", 2));
  record(g, 0x041e, new Bytes().u16(165).str("[h]:mm", 2));
  // XF records: same indexes as STYLE in make-xlsx.mjs (general, date, date-time, 0.00, [h]:mm).
  for (const fmt of [0, 14, 164, 2, 165]) record(g, 0x00e0, new Bytes().u16(0).u16(fmt).u16(0x0001).raw(new Array(14).fill(0)));
  const offsetFields = [];
  sheets.forEach((sheet) => {
    const body = new Bytes().u32(0).u8(sheet.hidden ? 1 : 0).u8(sheet.chart ? 2 : 0).str(sheet.name, 1);
    offsetFields.push(g.data.length + 4);
    record(g, 0x0085, body);
  });
  writeSst(g, shared, sstChunk);
  record(g, 0x000a);

  // Patch the stream offsets of the sheet substreams into the BOUNDSHEET records.
  let offset = g.data.length;
  const bytes = [...g.data];
  substreams.forEach((sub, i) => {
    for (let k = 0; k < 4; k++) bytes[offsetFields[i] + k] = (offset >>> (8 * k)) & 0xff;
    offset += sub.length;
    for (const v of sub) bytes.push(v);
  });
  return makeCompoundFile({ [workbookStream]: Uint8Array.from(bytes), ...extraStreams });
}

/** SST then CONTINUE records of at most `chunk` bytes; a split string resumes with a flags byte. */
function writeSst(out, strings, chunk) {
  const recs = [new Bytes().u32(strings.length).u32(strings.length)];
  let cur = recs[0];
  const room = () => chunk - cur.data.length;
  const next = () => { cur = new Bytes(); recs.push(cur); };
  for (const s of strings) {
    const wide = isWide(s);
    if (room() < 3) next();
    cur.u16(s.length).u8(wide ? 1 : 0);
    for (const ch of s) {
      if (room() < (wide ? 2 : 1)) { next(); cur.u8(wide ? 1 : 0); }
      if (wide) cur.u16(ch.charCodeAt(0));
      else cur.u8(ch.charCodeAt(0));
    }
  }
  recs.forEach((r, i) => record(out, i === 0 ? 0x00fc : 0x003c, r));
}

/**
 * Compound file (version 3, 512-byte sectors) holding the given streams at the root. Streams
 * under 4096 bytes go to the mini stream, as Excel and other writers do.
 */
export function makeCompoundFile(streams) {
  const SECTOR = 512, MINI = 64, CUTOFF = 4096, END = 0xfffffffe, FREE = 0xffffffff;
  const entries = Object.entries(streams);
  const big = entries.filter(([, d]) => d.length >= CUTOFF);
  const small = entries.filter(([, d]) => d.length < CUTOFF);
  const sectorsOf = (n, size) => Math.ceil(n / size);

  // Mini stream: small streams packed in 64-byte mini sectors.
  const miniStarts = new Map();
  const miniFat = [];
  const mini = [];
  for (const [name, data] of small) {
    const n = sectorsOf(data.length, MINI);
    if (n === 0) { miniStarts.set(name, END); continue; }
    miniStarts.set(name, miniFat.length);
    for (let i = 0; i < n; i++) miniFat.push(i === n - 1 ? END : miniFat.length + 1);
    const padded = new Uint8Array(n * MINI); padded.set(data); mini.push(...padded);
  }

  // Regular sectors after the FAT: directory, mini FAT, mini stream, then the big streams.
  const dirEntries = 1 + entries.length;
  const blocks = [
    { name: "dir", size: Math.ceil(dirEntries / 4) * SECTOR },
    { name: "minifat", size: miniFat.length * 4 },
    { name: "ministream", size: mini.length },
    ...big.map(([name, data]) => ({ name, size: data.length, data })),
  ];
  const dataSectors = blocks.reduce((n, b) => n + sectorsOf(b.size, SECTOR), 0);
  let fatSectors = 1;
  while (fatSectors * 128 < dataSectors + fatSectors) fatSectors++;
  if (fatSectors > 109) throw new Error("test workbook too large for this writer");
  const fat = new Array(fatSectors * 128).fill(FREE);
  for (let i = 0; i < fatSectors; i++) fat[i] = 0xfffffffd;
  let sector = fatSectors;
  for (const b of blocks) {
    const n = sectorsOf(b.size, SECTOR);
    b.start = n ? sector : END;
    for (let i = 0; i < n; i++) fat[sector + i] = i === n - 1 ? END : sector + i + 1;
    sector += n;
  }
  const at = Object.fromEntries(blocks.map((b) => [b.name, b]));

  const file = new Uint8Array((1 + sector) * SECTOR);
  const v = new DataView(file.buffer);
  const off = (s) => (s + 1) * SECTOR;
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((b, i) => (file[i] = b));
  v.setUint16(0x18, 0x3e, true); v.setUint16(0x1a, 3, true); v.setUint16(0x1c, 0xfffe, true);
  v.setUint16(0x1e, 9, true); v.setUint16(0x20, 6, true);
  v.setUint32(0x2c, fatSectors, true); v.setUint32(0x30, at.dir.start, true);
  v.setUint32(0x38, CUTOFF, true);
  v.setUint32(0x3c, at.minifat.start, true); v.setUint32(0x40, sectorsOf(at.minifat.size, SECTOR), true);
  v.setUint32(0x44, END, true); v.setUint32(0x48, 0, true);
  for (let i = 0; i < 109; i++) v.setUint32(0x4c + 4 * i, i < fatSectors ? i : FREE, true);
  fat.forEach((x, i) => v.setUint32(off(0) + 4 * i, x, true));

  const dirEntry = (index, name, type, start, size, child) => {
    const o = off(at.dir.start) + index * 128;
    for (let i = 0; i < name.length; i++) v.setUint16(o + 2 * i, name.charCodeAt(i), true);
    v.setUint16(o + 0x40, (name.length + 1) * 2, true);
    file[o + 0x42] = type; file[o + 0x43] = 1;
    v.setUint32(o + 0x44, FREE, true); // left sibling
    v.setUint32(o + 0x48, type === 5 || index === entries.length ? FREE : index + 1, true); // right sibling
    v.setUint32(o + 0x4c, child, true);
    v.setUint32(o + 0x74, start, true); v.setUint32(o + 0x78, size, true);
  };
  dirEntry(0, "Root Entry", 5, at.ministream.start, mini.length, entries.length ? 1 : FREE);
  entries.forEach(([name, data], i) => {
    const start = data.length >= CUTOFF ? at[name].start : miniStarts.get(name);
    dirEntry(i + 1, name, 2, start, data.length, FREE);
  });
  for (let i = dirEntries; i < Math.ceil(dirEntries / 4) * 4; i++) {
    const o = off(at.dir.start) + i * 128;
    v.setUint32(o + 0x44, FREE, true); v.setUint32(o + 0x48, FREE, true); v.setUint32(o + 0x4c, FREE, true);
  }
  miniFat.forEach((x, i) => v.setUint32(off(at.minifat.start) + 4 * i, x, true));
  const writeBlock = (b, data) => {
    for (let i = 0; i < sectorsOf(b.size, SECTOR); i++)
      file.set(data.subarray(i * SECTOR, (i + 1) * SECTOR), off(b.start + i));
  };
  if (mini.length) writeBlock(at.ministream, Uint8Array.from(mini));
  for (const [name, data] of big) writeBlock(at[name], data);
  return file;
}
