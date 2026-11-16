/** Builds the ECharts option of the histogram view (pure, testable). */
import type { CustomSeriesOption, EChartsOption } from "echarts";
import type { ChartTheme } from "./chartOptions";
import type { ColumnStats, Histogram } from "./stats";
import { formatNumber } from "./tooltip";

export interface HistogramInput {
  name: string;
  color: string;
  histogram: Histogram;
  stats: ColumnStats;
  /** Name of the saved PNG before " - <column> histogram": file name without extension (+ sheet). */
  baseName: string;
  /** X axis range: the bins of the whole column. */
  extent: [number, number];
  /** Zoomed X range; undefined = the whole column. */
  zoom?: [number, number];
}

/** Id of the bar series, so a zoom can replace its bins only. */
export const HIST_SERIES_ID = "bins";

/** One row per bin: left edge, right edge, count. */
export function histogramRows({ start, width, counts }: Histogram): number[][] {
  return counts.map((c, i) => [start + i * width, start + (i + 1) * width, c]);
}

interface RenderApi {
  value(dim: number): number;
  coord(point: [number, number]): [number, number];
  style(extra?: object): object;
}

export function buildHistogramOption(input: HistogramInput, theme: ChartTheme): EChartsOption {
  const total = input.stats.count;
  const [min, max] = input.extent;
  const zoom = input.zoom ? { startValue: input.zoom[0], endValue: input.zoom[1] } : {};
  // The two labels sit at different heights, so they stay readable when mean = median.
  const marker = (name: string, value: number, type: "solid" | "dashed", distance: number) => ({
    name,
    xAxis: value,
    lineStyle: { color: theme.foreground, type, width: 1.5 },
    label: {
      formatter: `${name} ${formatNumber(value)}`,
      color: theme.foreground,
      position: "end" as const,
      distance,
    },
  });
  const lines = Number.isFinite(input.stats.mean)
    ? [
        marker("mean", input.stats.mean, "solid", 22),
        marker("median", input.stats.median, "dashed", 5),
      ]
    : [];

  const series: CustomSeriesOption = {
    type: "custom",
    id: HIST_SERIES_ID,
    name: input.name,
    data: histogramRows(input.histogram),
    // Bins cut by the edges of a zoomed window stay inside the plot.
    clip: true,
    encode: { x: [0, 1], y: 2 },
    renderItem: (_params, api) => {
      const a = api as unknown as RenderApi;
      const [x0, y0] = a.coord([a.value(0), a.value(2)]);
      const [x1, base] = a.coord([a.value(1), 0]);
      return {
        type: "rect",
        shape: { x: x0, y: y0, width: Math.max(x1 - x0 - 1, 1), height: base - y0 },
        style: a.style({ fill: input.color }),
      };
    },
    markLine: { symbol: "none", silent: true, animation: false, data: lines },
  };

  return {
    animation: false,
    backgroundColor: "transparent",
    textStyle: { fontFamily: theme.fontFamily, color: theme.foreground },
    grid: { left: 64, right: 32, top: 76, bottom: 84 },
    title: {
      text: input.name,
      left: 8,
      top: 4,
      textStyle: { color: theme.foreground, fontSize: 14, fontWeight: "normal" },
    },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (raw) => {
        const [from, to, count] = (raw as { value: number[] }).value;
        const share = total ? ((100 * count) / total).toFixed(1) : "0";
        return `${formatNumber(from)} – ${formatNumber(to)}<br/><b>${count}</b> values (${share} %)`;
      },
    },
    toolbox: {
      right: 8,
      top: 0,
      iconStyle: { borderColor: theme.mutedForeground },
      feature: {
        dataZoom: { yAxisIndex: "none", title: { zoom: "Zoom to area", back: "Undo zoom" } },
        restore: { title: "Reset zoom" },
        saveAsImage: {
          title: "Save as PNG",
          name: `${input.baseName} - ${input.name} histogram`,
          backgroundColor: theme.background,
        },
      },
    },
    // Zooming re-bins the visible range (see histogramZoom.ts): no filtering by ECharts.
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none", ...zoom },
      {
        type: "slider",
        xAxisIndex: 0,
        height: 22,
        bottom: 10,
        filterMode: "none",
        showDataShadow: false,
        labelFormatter: (value: number) => formatNumber(value),
        ...zoom,
      },
    ],
    xAxis: {
      type: "value",
      name: input.name,
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: theme.foreground },
      min,
      max,
      scale: true,
      axisLabel: { color: theme.mutedForeground, hideOverlap: true },
      axisLine: { lineStyle: { color: theme.mutedForeground } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "count",
      nameLocation: "middle",
      nameGap: 48,
      nameTextStyle: { color: theme.foreground },
      minInterval: 1,
      axisLabel: { color: theme.mutedForeground },
      splitLine: { lineStyle: { color: "rgba(128,128,128,0.22)" } },
    },
    series: [series],
  };
}
