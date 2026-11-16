import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { tableFromSheet } from "../../src/webview/parse/sheetTable";
import type { NumericColumn, TextColumn } from "../../src/webview/parse/table";
import { readWorkbook } from "../../src/webview/parse/readWorkbook";
import { isDateFormat, type Cell } from "../../src/webview/parse/workbook";
import { columnIndex, unescapeXml } from "../../src/webview/parse/xlsx";
import { hourlyWorkbook, makeXlsx, STYLE } from "../fixtures/make-xlsx.mjs";

const utc = (...args: [number, number, number, number?, number?]) =>
  Date.UTC(args[0], args[1] - 1, args[2], args[3] ?? 0, args[4] ?? 0);

describe("workbook reader", () => {
  it("lists worksheets in tab order, skips chart sheets, flags hidden ones", () => {
    const book = readWorkbook(hourlyWorkbook(10));
    expect(book.sheets).toEqual([
      { name: "Readme", hidden: false },
      { name: "Hourly", hidden: false },
      { name: "Daily", hidden: false },
      { name: "Lookup", hidden: true },
    ]);
    expect(book.sheets[book.defaultSheet].name).toBe("Hourly");
  });

  it("falls back to the first visible sheet when the active tab is a chart or hidden", () => {
    const sheets = [
      { name: "Hidden", hidden: true, rows: [[1]] },
      { name: "Chart", chart: true },
      { name: "Data", rows: [[1]] },
    ];
    expect(readWorkbook(makeXlsx({ sheets, activeTab: 1 })).defaultSheet).toBe(1);
    expect(readWorkbook(makeXlsx({ sheets, activeTab: 0 })).defaultSheet).toBe(1);
  });

  it("reads every kind of cell, with formula results instead of formulas", () => {
    const book = readWorkbook(
      makeXlsx({
        sheets: [
          {
            name: "S",
            rows: [
              [1.5, "text & <more>", true, { inline: "inline" }, { error: "#DIV/0!" }],
              [
                { f: "A1*2", v: 3 },
                { f: 'CONCAT("a","b")', v: "ab" },
                { f: "A1+1" },
                { date: new Date(utc(2020, 3, 1)) },
                new Date(utc(2020, 3, 1, 13, 30)),
              ],
              [
                { v: 0.5, style: STYLE.elapsed },
                { v: 2.25, style: STYLE.decimals },
              ],
            ],
          },
        ],
      }),
    );
    const sheet = book.readSheet("S");
    expect(sheet.rows[0]).toEqual([1.5, "text & <more>", true, "inline", null]);
    expect(sheet.rows[1]).toEqual([
      3,
      "ab",
      null,
      { ms: utc(2020, 3, 1) },
      { ms: utc(2020, 3, 1, 13, 30) },
    ]);
    expect(sheet.rows[2]).toEqual([0.5, 2.25]);
    expect(sheet.formulasWithoutResult).toBe(1);
  });

  it("supports the 1904 date system and cells without references", () => {
    const book = readWorkbook(
      makeXlsx({
        date1904: true,
        sheets: [
          {
            name: "S",
            omitRefs: true,
            rows: [
              ["d", "v"],
              [new Date(utc(2021, 6, 15, 6)), 7],
            ],
          },
        ],
      }),
    );
    expect(book.readSheet("S").rows[1]).toEqual([{ ms: utc(2021, 6, 15, 6) }, 7]);
  });

  it("rejects non-workbook files with a clear message", () => {
    expect(() => readWorkbook(strToU8("a,b\n1,2\n"))).toThrow(/not an Excel workbook/);
    expect(() => readWorkbook(zipSync({ "a.txt": strToU8("x") }))).toThrow(/not an Excel/);
  });

  it("decodes cell references, entities and number formats", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AA10")).toBe(26);
    expect(columnIndex("xfd1")).toBe(16383);
    expect(unescapeXml("a &amp; b &#x41;&#66; _x000D_")).toBe("a & b AB \r");
    expect(isDateFormat(14, undefined)).toBe(true);
    expect(isDateFormat(2, undefined)).toBe(false);
    expect(isDateFormat(164, "yyyy\\-mm\\-dd\\ hh:mm")).toBe(true);
    expect(isDateFormat(165, "[h]:mm")).toBe(false);
    expect(isDateFormat(166, '0.0 "days"')).toBe(false);
    expect(isDateFormat(167, "[Red]#,##0.00;[Blue]-#,##0.00")).toBe(false);
    expect(isDateFormat(168, "[$-407]dd/mm/yyyy;@")).toBe(true);
  });
});

describe("sheet to table", () => {
  it("skips a title above the table, types columns, keeps formula results", () => {
    const book = readWorkbook(hourlyWorkbook(48));
    const table = tableFromSheet(book.readSheet("Hourly").rows);
    expect(table.hasHeader).toBe(true);
    expect(table.rowCount).toBe(48);
    expect(table.columns.map((c) => [c.name, c.kind])).toEqual([
      ["timestamp", "time"],
      ["q_demand_kw", "number"],
      ["q_hp_kw", "number"],
      ["q_boiler_kw", "number"],
      ["t_out_c", "number"],
      ["status", "text"],
    ]);
    const time = table.columns[0] as NumericColumn;
    expect(time.values[1]).toBe(utc(2020, 1, 1, 1));
    const boiler = table.columns[3] as NumericColumn;
    const demand = table.columns[1] as NumericColumn;
    expect(boiler.values[0]).toBeCloseTo(demand.values[0] - 90, 6);
  });

  it("reads a table that does not start in A1, drops empty columns, reads text numbers", () => {
    const sparse: (Cell[] | undefined)[] = [];
    sparse[2] = [null, "when", null, "value", "flag"];
    sparse[3] = [null, "01.02.2020 10:00", null, "1,5", false];
    sparse[4] = [null, { ms: utc(2020, 2, 1, 11) }, null, 2, true];
    sparse[5] = [null, "01.02.2020 12:00", null, "NA", true];
    const table = tableFromSheet(sparse);
    expect(table.columns.map((c) => [c.name, c.kind, c.index])).toEqual([
      ["when", "time", 0],
      ["value", "number", 1],
      ["flag", "number", 2],
    ]);
    expect(Array.from((table.columns[0] as NumericColumn).values)).toEqual([
      utc(2020, 2, 1, 10),
      utc(2020, 2, 1, 11),
      utc(2020, 2, 1, 12),
    ]);
    expect(Array.from((table.columns[1] as NumericColumn).values)).toEqual([1.5, 2, NaN]);
    expect(Array.from((table.columns[2] as NumericColumn).values)).toEqual([0, 1, 1]);
  });

  it("detects a sheet without header and an empty sheet", () => {
    const noHeader = tableFromSheet([
      [1, 2],
      [3, 4],
    ]);
    expect(noHeader.hasHeader).toBe(false);
    expect(noHeader.columns.map((c) => c.name)).toEqual(["col1", "col2"]);
    expect(tableFromSheet([]).columns).toEqual([]);
    expect(tableFromSheet([undefined, [null, ""]]).columns).toEqual([]);
  });

  it("shows dates of a mixed text column as text", () => {
    const table = tableFromSheet([["label"], ["a"], [{ ms: utc(2020, 1, 1, 6) }], [3]]);
    expect((table.columns[0] as TextColumn).values).toEqual(["a", "2020-01-01 06:00", "3"]);
  });
});
