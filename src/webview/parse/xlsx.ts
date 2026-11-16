/**
 * Minimal reader for Excel workbooks in the Office Open XML format (.xlsx, .xlsm): the list of
 * worksheets and the values of their cells.
 */
import { unzipSync } from "fflate";
import { parseTimestamp } from "./values";
import {
  isDateFormat,
  pickDefaultSheet,
  serialToMs,
  type Cell,
  type SheetData,
  type Workbook,
} from "./workbook";

const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

export function readXlsx(bytes: Uint8Array): Workbook {
  // Everything except the sheets themselves and embedded media: small XML parts.
  const parts = unzipSync(bytes, {
    filter: (f) => /\.(xml|rels)$/i.test(f.name) && !/worksheets\//i.test(f.name),
  });
  const text = (name: string) => (parts[name] ? decode(parts[name]) : undefined);

  const bookPath =
    relationships(text("_rels/.rels") ?? "", "").find((r) => r.type === "officeDocument")?.target ??
    "xl/workbook.xml";
  const bookXml = text(bookPath);
  if (bookXml === undefined) throw new Error("This file is not an Excel workbook (.xlsx).");
  const rels = new Map(
    relationships(text(relsPath(bookPath)) ?? "", bookPath).map((r) => [r.id, r]),
  );

  const date1904 = elements(bookXml, "workbookPr").some((e) => /^(1|true)$/.test(e.attrs.date1904));
  const activeTab = Number(elements(bookXml, "workbookView")[0]?.attrs.activeTab ?? 0);
  const all = elements(bookXml, "sheet").map((e) => ({
    name: unescapeXml(e.attrs.name ?? ""),
    hidden: (e.attrs.state ?? "visible") !== "visible",
    rel: rels.get(e.attrs.id ?? ""),
  }));
  const worksheets = all.filter((s) => s.rel?.type === "worksheet");
  const paths = new Map(worksheets.map((s) => [s.name, s.rel!.target]));
  const sheets = worksheets.map(({ name, hidden }) => ({ name, hidden }));

  const defaultSheet = pickDefaultSheet(all, worksheets, activeTab);

  const ctx: SheetContext = {
    shared: sharedStrings(text(findPart(rels, "sharedStrings") ?? "xl/sharedStrings.xml") ?? ""),
    dateStyles: dateStyles(text(findPart(rels, "styles") ?? "xl/styles.xml") ?? ""),
    date1904,
  };

  return {
    sheets,
    defaultSheet,
    readSheet(name: string): SheetData {
      const path = paths.get(name);
      if (!path) throw new Error(`No sheet named "${name}" in this workbook.`);
      const data = unzipSync(bytes, { filter: (f) => f.name === path })[path];
      if (!data) throw new Error(`The sheet "${name}" is missing from the file.`);
      return readSheetXml(data, ctx);
    },
  };
}

interface SheetContext {
  shared: string[];
  /** Style indexes (cellXfs) whose number format shows a date or time. */
  dateStyles: Set<number>;
  date1904: boolean;
}

/** Scans the sheet XML row by row, decoding it in slices so a huge sheet is never one string. */
function readSheetXml(data: Uint8Array, ctx: SheetContext): SheetData {
  const out: SheetData = { rows: [], formulasWithoutResult: 0 };
  const decoder = new TextDecoder();
  const SLICE = 8 << 20;
  let buffer = "";
  let nextRow = 0;
  const scan = (xml: string) => {
    for (const row of elements(xml, "row")) {
      const r = row.attrs.r ? Number(row.attrs.r) - 1 : nextRow;
      nextRow = r + 1;
      if (row.body) out.rows[r] = readCells(row.body, ctx, out);
    }
  };
  for (let i = 0; i < data.length; i += SLICE) {
    buffer += decoder.decode(data.subarray(i, i + SLICE), { stream: true });
    const end = Math.max(buffer.lastIndexOf("</row>") + 6, buffer.lastIndexOf(":row>") + 5);
    if (end > 5) {
      scan(buffer.slice(0, end));
      buffer = buffer.slice(end);
    }
  }
  scan(buffer + decoder.decode());
  return out;
}

function readCells(xml: string, ctx: SheetContext, out: SheetData): Cell[] {
  const cells: Cell[] = [];
  let nextCol = 0;
  for (const c of elements(xml, "c")) {
    const col = c.attrs.r ? columnIndex(c.attrs.r) : nextCol;
    nextCol = col + 1;
    const body = c.body ?? "";
    const v = /<(?:[\w.-]+:)?v>([\s\S]*?)<\/(?:[\w.-]+:)?v>/.exec(body)?.[1];
    const type = c.attrs.t ?? "n";
    let value: Cell = null;
    if (type === "inlineStr") value = richText(body);
    else if (v === undefined) {
      if (/<(?:[\w.-]+:)?f[\s>/]/.test(body)) out.formulasWithoutResult++;
    } else if (type === "s") value = ctx.shared[Number(v)] ?? null;
    else if (type === "str") value = unescapeXml(v);
    else if (type === "b") value = v.trim() === "1";
    else if (type === "d") value = timeCell(parseTimestamp(v, "ymd"));
    else if (type === "n") {
      const n = Number(v);
      if (v.trim() !== "" && Number.isFinite(n)) {
        value = ctx.dateStyles.has(Number(c.attrs.s ?? 0))
          ? timeCell(serialToMs(n, ctx.date1904))
          : n;
      }
    } // "e" (error) stays null
    cells[col] = value;
  }
  return cells;
}

const timeCell = (ms: number): Cell => (Number.isNaN(ms) ? null : { ms });

/** "BC12" -> 54 (0-based column of a cell reference). */
export function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i) & ~32; // upper case
    if (code < 65 || code > 90) break;
    n = n * 26 + code - 64;
  }
  return n - 1;
}

function sharedStrings(xml: string): string[] {
  return elements(xml, "si").map((si) => richText(si.body ?? ""));
}

/** Text of a string item: plain <t>, or rich-text runs; phonetic hints (<rPh>) are skipped. */
function richText(xml: string): string {
  const plain = xml.replace(/<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh>/g, "");
  return elements(plain, "t")
    .map((t) => unescapeXml(t.body ?? ""))
    .join("");
}

function dateStyles(xml: string): Set<number> {
  const custom = new Map(
    elements(xml, "numFmt").map((e) => [
      Number(e.attrs.numFmtId),
      unescapeXml(e.attrs.formatCode ?? ""),
    ]),
  );
  const xfs = /<(?:[\w.-]+:)?cellXfs\b[\s\S]*?<\/(?:[\w.-]+:)?cellXfs>/.exec(xml)?.[0] ?? "";
  const out = new Set<number>();
  // Start tags only: an <xf> may hold children (<alignment/>, <protection/>).
  const starts = xfs.match(/<(?:[\w.-]+:)?xf\b[^>]*>/g) ?? [];
  starts.forEach((tag, index) => {
    const id = Number(attributes(tag).numFmtId ?? 0);
    if (isDateFormat(id, custom.get(id))) out.add(index);
  });
  return out;
}

interface Relationship {
  id: string;
  /** Last segment of the relationship type, e.g. "worksheet", "officeDocument". */
  type: string;
  /** Part path inside the archive, without leading slash. */
  target: string;
}

function relationships(xml: string, sourcePart: string): Relationship[] {
  const folder = sourcePart.includes("/")
    ? sourcePart.slice(0, sourcePart.lastIndexOf("/") + 1)
    : "";
  return elements(xml, "Relationship")
    .filter((e) => e.attrs.TargetMode !== "External")
    .map((e) => ({
      id: e.attrs.Id ?? "",
      type: (e.attrs.Type ?? "").replace(REL_TYPE, "").split("/").pop() ?? "",
      target: resolvePath(folder, unescapeXml(e.attrs.Target ?? "")),
    }));
}

function findPart(rels: Map<string, Relationship>, type: string): string | undefined {
  for (const r of rels.values()) if (r.type === type) return r.target;
  return undefined;
}

function relsPath(part: string): string {
  const slash = part.lastIndexOf("/");
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

function resolvePath(folder: string, target: string): string {
  const segments = (target.startsWith("/") ? target.slice(1) : folder + target).split("/");
  const out: string[] = [];
  for (const s of segments) {
    if (s === "..") out.pop();
    else if (s !== "." && s !== "") out.push(s);
  }
  return out.join("/");
}

interface Element {
  attrs: Record<string, string>;
  /** Inner XML; undefined for a self-closing element. */
  body?: string;
}

/** Elements with the given local name (any namespace prefix), non-nested. */
function elements(xml: string, name: string): Element[] {
  const re = new RegExp(
    String.raw`<(?:[\w.-]+:)?${name}(?=[\s/>])([^>]*?)(?:/>|>([\s\S]*?)</(?:[\w.-]+:)?${name}>)`,
    "g",
  );
  const out: Element[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push({ attrs: attributes(m[1]), body: m[2] });
  return out;
}

/** Attributes by local name (namespace prefixes dropped: r:id -> id). */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) {
    const key = m[1].includes(":") ? m[1].slice(m[1].indexOf(":") + 1) : m[1];
    out[key] = m[2] ?? m[3];
  }
  return out;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Decodes XML entities, then the _xHHHH_ escapes Excel uses for control characters. */
export function unescapeXml(s: string): string {
  if (!s.includes("&") && !s.includes("_x")) return s;
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) =>
      e[0] === "#"
        ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1))
        : ENTITIES[e.toLowerCase()],
    )
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
