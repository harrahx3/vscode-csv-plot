// Writes small but realistic .xlsx workbooks for the tests: shared strings, inline strings,
// date styles, formula cells with (or without) a saved result, errors, hidden and chart sheets.
import { strToU8, zipSync } from "fflate";

const esc = (s) =>
  String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

/** Excel column letters of a 0-based index: 0 -> A, 26 -> AA. */
export function columnLetters(index) {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Style indexes of the generated styles.xml. */
export const STYLE = { general: 0, date: 1, dateTime: 2, decimals: 3, elapsed: 4 };

/**
 * Cell specs: number | string | boolean | null | Date (date-time style) |
 * { date: Date, style? } | { f: "formula", v?: number | string } | { error: "#N/A" } |
 * { inline: "text" } | { v: number, style }.
 *
 * @param {{ sheets: { name: string, rows?: unknown[][], hidden?: boolean, chart?: boolean,
 *   omitRefs?: boolean }[], date1904?: boolean, activeTab?: number }} spec
 * @returns {Uint8Array}
 */
export function makeXlsx({ sheets, date1904 = false, activeTab = 0 }) {
  const shared = [];
  const sharedIndex = new Map();
  const str = (s) => {
    if (!sharedIndex.has(s)) {
      sharedIndex.set(s, shared.length);
      shared.push(s);
    }
    return sharedIndex.get(s);
  };
  const serial = (d) => d.getTime() / 86_400_000 + (date1904 ? 24107 : 25569);

  const cellXml = (spec, ref) => {
    const r = ref ? ` r="${ref}"` : "";
    if (spec === null || spec === undefined) return "";
    if (typeof spec === "number") return `<c${r}><v>${spec}</v></c>`;
    if (typeof spec === "boolean") return `<c${r} t="b"><v>${spec ? 1 : 0}</v></c>`;
    if (typeof spec === "string") return `<c${r} t="s"><v>${str(spec)}</v></c>`;
    if (spec instanceof Date) return `<c${r} s="${STYLE.dateTime}"><v>${serial(spec)}</v></c>`;
    if (spec.date) return `<c${r} s="${spec.style ?? STYLE.date}"><v>${serial(spec.date)}</v></c>`;
    if (spec.error) return `<c${r} t="e"><v>${spec.error}</v></c>`;
    if (spec.inline !== undefined)
      return `<c${r} t="inlineStr"><is><t xml:space="preserve">${esc(spec.inline)}</t></is></c>`;
    if (spec.f !== undefined) {
      const f = `<f>${esc(spec.f)}</f>`;
      if (spec.v === undefined) return `<c${r}${spec.style ? ` s="${spec.style}"` : ""}>${f}</c>`;
      if (typeof spec.v === "string") return `<c${r} t="str">${f}<v>${esc(spec.v)}</v></c>`;
      return `<c${r}${spec.style ? ` s="${spec.style}"` : ""}>${f}<v>${spec.v}</v></c>`;
    }
    return `<c${r} s="${spec.style ?? 0}"><v>${spec.v}</v></c>`;
  };

  const files = {};
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const RNS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const sheetEntries = [];
  const rels = [];
  const overrides = [];
  sheets.forEach((sheet, i) => {
    const id = `rId${i + 1}`;
    const state = sheet.hidden ? ' state="hidden"' : "";
    sheetEntries.push(`<sheet name="${esc(sheet.name)}" sheetId="${i + 1}"${state} r:id="${id}"/>`);
    if (sheet.chart) {
      rels.push(`<Relationship Id="${id}" Type="${REL}/chartsheet" Target="chartsheets/sheet${i + 1}.xml"/>`);
      files[`xl/chartsheets/sheet${i + 1}.xml`] = `<chartsheet ${NS}><sheetViews/></chartsheet>`;
      return;
    }
    rels.push(`<Relationship Id="${id}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`);
    overrides.push(`/xl/worksheets/sheet${i + 1}.xml`);
    const rowsXml = (sheet.rows ?? [])
      .map((row, ri) => {
        if (!row) return "";
        const cells = row
          .map((spec, ci) => cellXml(spec, sheet.omitRefs ? "" : `${columnLetters(ci)}${ri + 1}`))
          .join("");
        return sheet.omitRefs ? `<row>${cells}</row>` : `<row r="${ri + 1}">${cells}</row>`;
      })
      .join("");
    files[`xl/worksheets/sheet${i + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<worksheet ${NS} ${RNS}><sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"/><sheetData>${rowsXml}</sheetData>` +
      `<rowBreaks count="0"/></worksheet>`;
  });
  rels.push(`<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>`);
  rels.push(`<Relationship Id="rIdT" Type="${REL}/styles" Target="/xl/styles.xml"/>`);

  files["[Content_Types].xml"] =
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    overrides.map((p) => `<Override PartName="${p}" ContentType="application/xml"/>`).join("") +
    `</Types>`;
  files["_rels/.rels"] =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  files["xl/workbook.xml"] =
    `<workbook ${NS} ${RNS}><workbookPr${date1904 ? ' date1904="1"' : ""}/>` +
    `<bookViews><workbookView activeTab="${activeTab}"/></bookViews>` +
    `<sheets>${sheetEntries.join("")}</sheets></workbook>`;
  files["xl/_rels/workbook.xml.rels"] =
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;
  files["xl/styles.xml"] =
    `<styleSheet ${NS}><numFmts count="2">` +
    `<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/>` +
    `<numFmt numFmtId="165" formatCode="[h]:mm"/></numFmts>` +
    `<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/>` +
    `<xf numFmtId="164" applyNumberFormat="1"><alignment horizontal="left"/></xf>` +
    `<xf numFmtId="2" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/></cellXfs>` +
    `</styleSheet>`;
  files["xl/sharedStrings.xml"] =
    `<sst ${NS} count="${shared.length}" uniqueCount="${shared.length}">` +
    shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("") +
    `</sst>`;
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

/** One year hourly plant data, with a title above the table and a formula column. */
export function hourlyWorkbook(hours = 8760) {
  return makeXlsx(hourlySpec(hours));
}

/** Sheet specs of hourlyWorkbook (also written as .xls by make-xls.mjs). */
export function hourlySpec(hours = 8760) {
  const rows = [["Heat plant 2020 (synthetic)"], null, ["timestamp", "q_demand_kw", "q_hp_kw", "q_boiler_kw", "t_out_c", "status"]];
  for (let h = 0; h < hours; h++) {
    const day = Math.sin((2 * Math.PI * (h % 24)) / 24);
    const season = Math.cos((2 * Math.PI * h) / 8760);
    const demand = +(120 + 80 * season + 25 * day).toFixed(2);
    const hp = Math.min(demand, 90);
    const r = h + 4;
    rows.push([
      new Date(Date.UTC(2020, 0, 1, h)),
      demand,
      hp,
      { f: `B${r}-C${r}`, v: +(demand - hp).toFixed(2) },
      +(70 + 5 * season).toFixed(2),
      h % 1000 === 0 ? "check" : null,
    ]);
  }
  const daily = [["day", "energy_kwh", "peak_kw"]];
  for (let d = 0; d < 366; d++)
    daily.push([{ date: new Date(Date.UTC(2020, 0, 1 + d)) }, 2900 + 1900 * Math.cos((2 * Math.PI * d) / 366), 220 - d / 10]);
  return {
    activeTab: 1,
    sheets: [
      { name: "Readme", rows: [["This workbook holds synthetic data for the tests."]] },
      { name: "Hourly", rows },
      { name: "Chart", chart: true },
      { name: "Daily", rows: daily },
      { name: "Lookup", hidden: true, rows: [["k", "v"], [1, 2]] },
    ],
  };
}
