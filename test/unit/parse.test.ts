import { describe, expect, it } from "vitest";
import { detectDecimal, detectSeparator } from "../../src/webview/parse/detect";
import { parseTable, type NumericColumn, type TextColumn } from "../../src/webview/parse/table";
import { forEachRow } from "../../src/webview/parse/tokenize";
import { detectDateOrder, parseNumber, parseTimestamp } from "../../src/webview/parse/values";

const rows = (text: string, sep: string) => {
  const out: string[][] = [];
  forEachRow(text, sep, (f) => void out.push(f.slice()));
  return out;
};

describe("tokenizer", () => {
  it("splits plain lines and skips blank lines", () => {
    expect(rows("a,b\n1,2\r\n\n3,4\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("honours quoted fields with separators, escaped quotes and newlines", () => {
    expect(rows('name,note\n"x,y","he said ""hi"""\n"multi\nline",2\n', ",")).toEqual([
      ["name", "note"],
      ["x,y", 'he said "hi"'],
      ["multi\nline", "2"],
    ]);
  });

  it("ignores a byte-order mark and keeps empty trailing fields", () => {
    expect(rows("﻿a;b;\n1;;\n", ";")).toEqual([
      ["a", "b", ""],
      ["1", "", ""],
    ]);
  });
});

describe("separator and decimal detection", () => {
  it("detects comma", () => {
    expect(detectSeparator("a,b,c\n1,2,3\n4,5,6\n")).toEqual({ value: ",", confident: true });
  });

  it("detects semicolon with decimal comma", () => {
    const text =
      "time;p_kw;t_c\n" + Array.from({ length: 20 }, (_, i) => `${i};1,${i};70,5`).join("\n");
    expect(detectSeparator(text)).toEqual({ value: ";", confident: true });
    expect(detectDecimal(";", ["1,5", "70,25", "3"]).value).toBe(",");
  });

  it("detects tab and pipe", () => {
    expect(detectSeparator("a\tb\n1\t2\n3\t4").value).toBe("\t");
    expect(detectSeparator("a|b\n1|2\n3|4").value).toBe("|");
  });

  it("is not confident on a mixed file", () => {
    const text = "a,b;c\n1,2;3\n4;5,6\n7,8\n9;10\n";
    expect(detectSeparator(text).confident).toBe(false);
  });

  it("reports a decimal mark as unsure when both styles appear", () => {
    expect(detectDecimal(";", ["1,5", "2.5"]).confident).toBe(false);
  });

  it("is confident on a single-column file", () => {
    expect(detectSeparator("value\n1\n2\n")).toEqual({ value: ",", confident: true });
  });
});

describe("values", () => {
  it("parses numbers with either decimal mark", () => {
    expect(parseNumber(" 12.5 ", ".")).toBe(12.5);
    expect(parseNumber("12,5", ",")).toBe(12.5);
    expect(parseNumber("-1e3", ".")).toBe(-1000);
    expect(parseNumber("", ".")).toBeNaN();
    expect(parseNumber("abc", ".")).toBeNaN();
  });

  it("parses ISO timestamps as written (no local time zone shift)", () => {
    expect(parseTimestamp("2020-03-29 02:00", "ymd")).toBe(Date.UTC(2020, 2, 29, 2));
    expect(parseTimestamp("2020-01-01T00:00:00Z", "ymd")).toBe(Date.UTC(2020, 0, 1));
    expect(parseTimestamp("2020-01-01T01:00:00+01:00", "ymd")).toBe(Date.UTC(2020, 0, 1));
    expect(parseTimestamp("2020-01-01 00:00:00.250", "ymd")).toBe(Date.UTC(2020, 0, 1) + 250);
    expect(parseTimestamp("2020-13-01", "ymd")).toBeNaN();
  });

  it("parses European dates and detects the order", () => {
    expect(parseTimestamp("31.01.2020 13:30", "dmy")).toBe(Date.UTC(2020, 0, 31, 13, 30));
    expect(detectDateOrder(["01/02/2020", "13/02/2020"])).toBe("dmy");
    expect(detectDateOrder(["02/13/2020", "02/14/2020"])).toBe("mdy");
    expect(detectDateOrder(["01/02/2020"])).toBe("dmy");
    expect(detectDateOrder(["hello", "2020"])).toBeNull();
  });
});

describe("parseTable", () => {
  it("types columns and handles missing values", () => {
    const text = [
      "timestamp;q_demand_kw;t_out_c;label",
      "2020-01-01 00:00;12,5;70;a",
      "2020-01-01 01:00;;69,5;b",
      "2020-01-01 02:00;11;NA;c",
    ].join("\n");
    const t = parseTable(text);
    expect(t.separator.value).toBe(";");
    expect(t.decimal.value).toBe(",");
    expect(t.hasHeader).toBe(true);
    expect(t.rowCount).toBe(3);
    expect(t.columns.map((c) => c.kind)).toEqual(["time", "number", "number", "text"]);
    const q = t.columns[1] as NumericColumn;
    expect(Array.from(q.values)).toEqual([12.5, NaN, 11]);
    expect(q.maxAbs).toBe(12.5);
    expect((t.columns[0] as NumericColumn).values[1]).toBe(Date.UTC(2020, 0, 1, 1));
    expect((t.columns[3] as TextColumn).values).toEqual(["a", "b", "c"]);
  });

  it("names columns when there is no header and de-duplicates names", () => {
    expect(parseTable("1,2\n3,4\n").columns.map((c) => c.name)).toEqual(["col1", "col2"]);
    expect(parseTable("a,a,\n1,2,3\n").columns.map((c) => c.name)).toEqual(["a", "a (2)", "col3"]);
  });

  it("respects forced separator and decimal", () => {
    const t = parseTable("a;b\n1,5;2\n", { separator: ";", decimal: "." });
    expect(t.columns[0].kind).toBe("text");
    expect(t.decimal).toEqual({ value: ".", confident: true });
  });

  it("parses a year of hourly data quickly", () => {
    const lines = ["timestamp;" + Array.from({ length: 20 }, (_, i) => `v${i}_kw`).join(";")];
    for (let h = 0; h < 8760; h++) {
      const ts = new Date(Date.UTC(2020, 0, 1, h)).toISOString().slice(0, 16).replace("T", " ");
      lines.push(ts + ";" + Array.from({ length: 20 }, (_, i) => `${i},${h % 10}`).join(";"));
    }
    const start = performance.now();
    const t = parseTable(lines.join("\n"));
    const elapsed = performance.now() - start;
    expect(t.rowCount).toBe(8760);
    expect(t.columns).toHaveLength(21);
    expect((t.columns[5] as NumericColumn).values[3]).toBe(4.3);
    expect(elapsed).toBeLessThan(1000);
  });
});
