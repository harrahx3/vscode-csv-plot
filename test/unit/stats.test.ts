import * as echarts from "echarts";
import { describe, expect, it } from "vitest";
import { buildHistogramOption } from "../../src/webview/histogramOption";
import {
  autoBinCount,
  columnStats,
  countBetween,
  histogram,
  MAX_BINS,
  niceWidth,
  quantile,
  sortedValues,
} from "../../src/webview/stats";

const f64 = (values: number[]) => Float64Array.from(values);

describe("columnStats", () => {
  it("ignores missing values and matches the usual definitions", () => {
    const s = columnStats(f64([4, NaN, 1, 3, 2, NaN, 5]));
    expect(s.count).toBe(5);
    expect(s.missing).toBe(2);
    expect(s.sum).toBe(15);
    expect(s.mean).toBe(3);
    expect(s.median).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.q1).toBe(2);
    expect(s.q3).toBe(4);
    // Sample standard deviation of 1..5 is sqrt(2.5).
    expect(s.stdDev).toBeCloseTo(Math.sqrt(2.5), 12);
  });

  it("interpolates percentiles like Excel PERCENTILE.INC", () => {
    const sorted = sortedValues(f64([10, 20, 30, 40]));
    expect(quantile(sorted, 0.5)).toBe(25);
    expect(quantile(sorted, 0.25)).toBe(17.5);
    expect(quantile(sorted, 0.75)).toBe(32.5);
    expect(quantile(sorted, 0)).toBe(10);
    expect(quantile(sorted, 1)).toBe(40);
  });

  it("returns NaN (not 0) when there is nothing to describe", () => {
    const s = columnStats(f64([NaN, NaN]));
    expect(s.count).toBe(0);
    expect(s.missing).toBe(2);
    expect(Number.isNaN(s.mean)).toBe(true);
    expect(Number.isNaN(s.median)).toBe(true);
    expect(Number.isNaN(columnStats(f64([7])).stdDev)).toBe(true);
  });
});

describe("histogram", () => {
  it("rounds bin widths to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceWidth(0.7)).toBe(1);
    expect(niceWidth(1.3)).toBe(2);
    expect(niceWidth(2.2)).toBe(2.5);
    expect(niceWidth(37)).toBe(50);
    expect(niceWidth(100)).toBe(100);
  });

  it("puts every value in exactly one bin, the maximum in the last one", () => {
    const values = Array.from({ length: 1000 }, (_, i) => Math.sin(i) * 50 + 0.123);
    const sorted = sortedValues(f64(values));
    const h = histogram(sorted, 20);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(h.start).toBeLessThanOrEqual(sorted[0]);
    expect(h.start + h.counts.length * h.width).toBeGreaterThanOrEqual(sorted[999]);
    expect(h.width).toBe(5);
    expect(h.counts.length).toBeGreaterThanOrEqual(20);
    expect(h.counts.length).toBeLessThanOrEqual(22);
  });

  it("gives whole numbers their own centred bins", () => {
    const h = histogram(sortedValues(f64([0, 1, 1, 2, 2, 2, 3])), 50);
    expect(h).toEqual({ start: -0.5, width: 1, counts: [1, 2, 3, 1] });
  });

  it("re-bins a zoomed range with narrower bins, counting whole bins at its edges", () => {
    const sorted = sortedValues(f64(Array.from({ length: 1000 }, (_, i) => i / 10))); // 0..99.9
    const h = histogram(sorted, 10, [20, 30]);
    expect(h.width).toBe(1);
    expect(h.start).toBe(20);
    expect(h.counts).toHaveLength(10);
    expect(h.counts.every((c) => c === 10)).toBe(true);
    // A range that cuts bins: the edge bins still hold all their values.
    const cut = histogram(sorted, 10, [20.5, 29.5]);
    expect(cut.start).toBe(20);
    expect(cut.counts).toEqual(new Array(10).fill(10));
    expect(countBetween(sorted, 20, 30)).toBe(101);
    expect(countBetween(sorted, 200, 300)).toBe(0);
  });

  it("zooms whole numbers without splitting a value across bins", () => {
    const sorted = sortedValues(f64([0, 1, 1, 2, 2, 2, 3, 3, 4, 9, 10]));
    expect(histogram(sorted, 50, [1.7, 3.2])).toEqual({ start: 1.5, width: 1, counts: [3, 2] });
    // The column maximum on the last edge stays in the last bin.
    expect(histogram(sortedValues(f64([0.5, 5, 10])), 2, [5, 10]).counts).toEqual([1, 1]);
  });

  it("handles a constant column and an empty one", () => {
    expect(histogram(sortedValues(f64([5, 5, 5]))).counts).toEqual([3]);
    expect(histogram(sortedValues(f64([]))).counts).toEqual([]);
  });

  it("chooses a sensible automatic bin count", () => {
    const normalish = Array.from({ length: 10_000 }, (_, i) => Math.tan((i / 10_000 - 0.5) * 3));
    const n = autoBinCount(sortedValues(f64(normalish)));
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThanOrEqual(MAX_BINS);
    // Interquartile range of zero: falls back to Sturges' rule.
    expect(autoBinCount(sortedValues(f64([1, 1, 1, 1, 1, 1, 1, 9])))).toBe(4);
  });
});

describe("buildHistogramOption", () => {
  const theme = {
    dark: false,
    foreground: "#333333",
    mutedForeground: "#666666",
    background: "#ffffff",
    fontFamily: "sans-serif",
  };

  it("draws one bar per bin with mean and median lines, and renders", () => {
    const sorted = sortedValues(f64([1, 2, 2, 3, 3, 3, 10]));
    const stats = columnStats(sorted, sorted);
    const h = histogram(sorted, 5);
    const option = buildHistogramOption(
      {
        name: "q_kw",
        color: "#2a78d6",
        histogram: h,
        stats,
        baseName: "data",
        extent: [h.start, h.start + h.counts.length * h.width],
      },
      theme,
    );
    const series = (option.series as { data: number[][]; markLine: { data: object[] } }[])[0];
    expect(series.data).toHaveLength(h.counts.length);
    expect(series.data[0]).toEqual([h.start, h.start + h.width, h.counts[0]]);
    expect(series.markLine.data.map((d) => (d as { name: string }).name)).toEqual([
      "mean",
      "median",
    ]);
    const tooltip = option.tooltip as { formatter: (p: unknown) => string };
    expect(tooltip.formatter({ value: [0, 2, 1] })).toContain("14.3 %");
    const toolbox = option.toolbox as { feature: { saveAsImage: { name: string } } };
    expect(toolbox.feature.saveAsImage.name).toBe("data - q_kw histogram");

    const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 800, height: 400 });
    chart.setOption(option);
    const svg = chart.renderToSVGString();
    chart.dispose();
    expect(svg).toContain("<path");
    expect(svg).toContain("median");
  });

  it("offers zoom tools and opens on the zoomed range", () => {
    const sorted = sortedValues(f64([1, 2, 2, 3, 3, 3, 10]));
    const h = histogram(sorted, 5);
    const option = buildHistogramOption(
      {
        name: "q_kw",
        color: "#2a78d6",
        histogram: histogram(sorted, 5, [2, 4]),
        stats: columnStats(sorted, sorted),
        baseName: "data",
        extent: [h.start, h.start + h.counts.length * h.width],
        zoom: [2, 4],
      },
      theme,
    );
    const toolbox = option.toolbox as { feature: Record<string, unknown> };
    expect(Object.keys(toolbox.feature)).toEqual(["dataZoom", "restore", "saveAsImage"]);
    const zooms = option.dataZoom as { startValue?: number; endValue?: number }[];
    expect(zooms.map((z) => [z.startValue, z.endValue])).toEqual([
      [2, 4],
      [2, 4],
    ]);
    const xAxis = option.xAxis as { min: number; max: number };
    expect([xAxis.min, xAxis.max]).toEqual([h.start, h.start + h.counts.length * h.width]);
  });
});
