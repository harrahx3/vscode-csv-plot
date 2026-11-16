import * as echarts from "echarts";
import { describe, expect, it } from "vitest";
import { assignAxes } from "../../src/webview/axes";
import {
  buildChartOption,
  isMonotonic,
  seriesStyle,
  type ChartInput,
} from "../../src/webview/chartOptions";
import { formatUtc, rowAt, tooltipHtml } from "../../src/webview/tooltip";
import { parseTable, type NumericColumn } from "../../src/webview/parse/table";

const theme = {
  dark: false,
  foreground: "#333333",
  mutedForeground: "#666666",
  background: "#ffffff",
  fontFamily: "sans-serif",
};

const csv = [
  "timestamp;a_kw;b_kw;t_c",
  "2020-01-01 00:00;1;2;70",
  "2020-01-01 01:00;-1;3;71",
  "2020-01-01 02:00;;4;72",
].join("\n");

function input(mode: "lines" | "stacked", x: "time" | "row" = "time"): ChartInput {
  const table = parseTable(csv);
  const ys = table.columns.slice(1) as NumericColumn[];
  return {
    x: x === "time" ? table.columns[0] : null,
    ys,
    rowCount: table.rowCount,
    mode,
    assignment: assignAxes(ys),
    fileName: "data.csv",
  };
}

function render(option: echarts.EChartsOption): string {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 800, height: 400 });
  chart.setOption(option);
  const svg = chart.renderToSVGString();
  chart.dispose();
  return svg;
}

describe("buildChartOption", () => {
  it("builds a time axis, one Y axis per unit, gaps for missing values", () => {
    const option = buildChartOption(input("lines"), theme);
    expect((option.xAxis as { type: string }).type).toBe("time");
    expect(option.yAxis).toHaveLength(2);
    const series = option.series as { yAxisIndex: number; stack?: string }[];
    expect(series.map((s) => s.yAxisIndex)).toEqual([0, 0, 1]);
    expect(series.every((s) => s.stack === undefined)).toBe(true);
    const source = (option.dataset as { source: Record<string, unknown[]> }).source;
    expect(source.s0).toEqual([1, -1, null]);
    expect(source.x[0]).toBe(Date.UTC(2020, 0, 1));
    expect(render(option)).toContain("<svg");
  });

  it("stacks per axis only in stacked mode", () => {
    const option = buildChartOption(input("stacked"), theme);
    const series = option.series as { stack?: string; areaStyle?: object }[];
    expect(series.map((s) => s.stack)).toEqual(["axis0", "axis0", "axis1"]);
    expect(series.every((s) => s.areaStyle)).toBe(true);
    expect(render(option)).toContain("<svg");
  });

  it("uses the row number when there is no X column", () => {
    const option = buildChartOption(input("lines", "row"), theme);
    const source = (option.dataset as { source: Record<string, unknown[]> }).source;
    expect(source.x).toEqual([1, 2, 3]);
    expect((option.xAxis as { type: string }).type).toBe("value");
    expect(render(option)).toContain("<svg");
  });

  it("renders a million points without error", () => {
    const n = 1_000_000;
    const values = new Float64Array(n).map((_, i) => Math.sin(i / 1000));
    const col: NumericColumn = {
      name: "v_kw",
      index: 1,
      kind: "number",
      values,
      maxAbs: 1,
      hasOffset: false,
    };
    const option = buildChartOption(
      {
        x: null,
        ys: [col],
        rowCount: n,
        mode: "lines",
        assignment: assignAxes([col]),
        fileName: "big.csv",
      },
      theme,
    );
    expect(render(option)).toContain("<svg");
  });
});

describe("helpers", () => {
  it("keeps a column's colour independent of other ticked columns", () => {
    expect(seriesStyle({ index: 2 }, false)).toEqual(seriesStyle({ index: 2 }, false));
    expect(seriesStyle({ index: 8 }, false).dash).toBe("dashed");
  });

  it("formats timestamps as written", () => {
    expect(formatUtc(Date.UTC(2020, 2, 29, 2, 0))).toBe("2020-03-29 02:00");
    expect(formatUtc(Date.UTC(2020, 2, 29, 2, 0, 5))).toBe("2020-03-29 02:00:05");
  });

  it("finds the hovered row and lists every series in the tooltip", () => {
    const table = parseTable(csv);
    const ys = table.columns.slice(1) as NumericColumn[];
    const ctx = {
      x: table.columns[0],
      ys,
      colors: ["#000", "#111", "#222"],
      rowCount: 3,
      xSorted: true,
    };
    expect(rowAt(Date.UTC(2020, 0, 1, 1, 20), 0, ctx)).toBe(1);
    expect(rowAt(Date.UTC(2020, 0, 1, 1, 40), 0, ctx)).toBe(2);
    expect(rowAt(Date.UTC(2019, 0, 1), 0, ctx)).toBe(0);
    expect(rowAt(2.4, 0, { ...ctx, x: null })).toBe(1);
    const html = tooltipHtml([{ axisValue: Date.UTC(2020, 0, 1, 2), dataIndex: 0 }], ctx);
    expect(html).toContain("2020-01-01 02:00");
    expect(html).toContain("a_kw");
    expect(html).toContain("–"); // missing value
    expect(html).toContain("<b>72</b>");
  });

  it("detects a non-monotonic X", () => {
    expect(isMonotonic(new Float64Array([1, NaN, 2, 2, 3]))).toBe(true);
    expect(isMonotonic(new Float64Array([1, 3, 2]))).toBe(false);
  });
});
