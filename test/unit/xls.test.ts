import { describe, expect, it } from "vitest";
import { readWorkbook } from "../../src/webview/parse/readWorkbook";
import { tableFromSheet } from "../../src/webview/parse/sheetTable";
import type { NumericColumn } from "../../src/webview/parse/table";
import { decodeRk } from "../../src/webview/parse/xls";
import { encodeRk, hourlyXls, makeCompoundFile, makeXls } from "../fixtures/make-xls.mjs";

const utc = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h);
const LONG = "x".repeat(300) + "é€" + "y".repeat(50);

/** A BIFF8 stream made of raw records: [type, body bytes]. */
function biff(...recs: [number, number[]][]): Uint8Array {
  const out: number[] = [];
  for (const [type, body] of recs)
    out.push(type & 0xff, type >> 8, body.length & 0xff, body.length >> 8, ...body);
  return Uint8Array.from(out);
}
const BOF8 = [0x00, 0x06, 0x05, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

describe(".xls reader", () => {
  it("lists worksheets like the .xlsx reader: hidden flagged, chart sheets left out", () => {
    const book = readWorkbook(hourlyXls(10));
    expect(book.sheets).toEqual([
      { name: "Readme", hidden: false },
      { name: "Hourly", hidden: false },
      { name: "Daily", hidden: false },
      { name: "Lookup", hidden: true },
    ]);
    expect(book.sheets[book.defaultSheet].name).toBe("Hourly");
  });

  it("gives the same table as the .xlsx version of the workbook", () => {
    const table = tableFromSheet(readWorkbook(hourlyXls(48)).readSheet("Hourly").rows);
    expect(table.columns.map((c) => [c.name, c.kind])).toEqual([
      ["timestamp", "time"],
      ["q_demand_kw", "number"],
      ["q_hp_kw", "number"],
      ["q_boiler_kw", "number"],
      ["t_out_c", "number"],
      ["status", "text"],
    ]);
    expect((table.columns[0] as NumericColumn).values[5]).toBe(utc(2020, 1, 1, 5));
    expect((table.columns[3] as NumericColumn).values[0]).toBe(110);
    const daily = tableFromSheet(readWorkbook(hourlyXls(10)).readSheet("Daily").rows);
    expect(daily.rowCount).toBe(366);
    expect((daily.columns[2] as NumericColumn).values[1]).toBeCloseTo(219.9, 9);
  });

  it("reads every kind of cell and formula result, split strings, 1904 dates, mini stream", () => {
    const bytes = makeXls({
      sstChunk: 64, // forces strings to be split over CONTINUE records
      date1904: true,
      sheets: [
        {
          name: "Kinds €",
          mulrk: true,
          embeddedChart: true,
          rows: [
            ["name", "n", "d", "f"],
            [LONG, 1.5, new Date(utc(2021, 6, 15, 6)), { f: "1", v: 42.25 }],
            ["Ünïcode ∑", 0.5, { date: new Date(utc(2021, 1, 1)) }, { f: "1", v: "txt" }],
            [{ inline: "inl" }, 123456789, true, { f: "1", v: true }],
            [{ error: "#N/A" }, 3.14159, -7, { f: "1" }],
            [null, 1, 2, 3],
          ],
        },
      ],
    });
    expect(bytes.length).toBe(4096); // workbook stream under 4096 bytes: in the mini stream
    const rows = readWorkbook(bytes).readSheet("Kinds €").rows;
    expect(rows).toEqual([
      ["name", "n", "d", "f"],
      [LONG, 1.5, { ms: utc(2021, 6, 15, 6) }, 42.25],
      ["Ünïcode ∑", 0.5, { ms: utc(2021, 1, 1) }, "txt"],
      ["inl", 123456789, true, true],
      [null, 3.14159, -7, null],
      [undefined, 1, 2, 3],
    ]);
  });

  it("decodes RK numbers", () => {
    for (const v of [0, 1, -1, 536870911, -536870912, 0.5, 2.25, -3.75, 1.23, -45.67, 1e300]) {
      const rk = encodeRk(v);
      if (rk !== null) expect(decodeRk(rk | 0)).toBe(v);
    }
    expect(encodeRk(1.23)! & 3).toBe(3); // integer x 100
    expect(encodeRk(0.5)! & 3).toBe(0); // top bits of a double
  });

  it("explains files it cannot read", () => {
    const filepass = makeCompoundFile({
      Workbook: biff([0x0809, BOF8], [0x002f, [0, 0]], [0x000a, []]),
    });
    expect(() => readWorkbook(filepass)).toThrow(/password-protected/);
    const biff5 = makeCompoundFile({ Workbook: biff([0x0809, [0, 5, 5, 0]], [0x000a, []]) });
    expect(() => readWorkbook(biff5)).toThrow(/Excel 5\.0\/95/);
    const book = makeXls({ workbookStream: "Book", sheets: [{ name: "S", rows: [[1]] }] });
    expect(() => readWorkbook(book)).toThrow(/Excel 5\.0\/95/);
    const encrypted = makeCompoundFile({
      EncryptionInfo: new Uint8Array(10),
      EncryptedPackage: new Uint8Array(5000),
    });
    expect(() => readWorkbook(encrypted)).toThrow(/password-protected/);
    const other = makeCompoundFile({ WordDocument: new Uint8Array(5000) });
    expect(() => readWorkbook(other)).toThrow(/not an Excel workbook/);
  });
});
