/** Builds the ECharts option for the current table and selection (pure, testable). */
import type { EChartsOption, LineSeriesOption, YAXisComponentOption } from "echarts";
import type { DisplayMode } from "../shared/messages";
import type { AxisAssignment } from "./axes";
import type { Column, NumericColumn } from "./parse/table";
import { tooltipHtml, type TooltipContext } from "./tooltip";

/** Categorical palette (fixed order, validated for colour-vision deficiencies), light and dark steps. */
const PALETTE_LIGHT = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
];
const PALETTE_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];
/** Beyond eight columns the colours repeat with a different line dash. */
const DASHES = ["solid", "dashed", "dotted"] as const;

export interface ChartTheme {
  dark: boolean;
  foreground: string;
  mutedForeground: string;
  background: string;
  fontFamily: string;
}

export interface ChartInput {
  /** X column, or null for the row number. */
  x: Column | null;
  ys: NumericColumn[];
  rowCount: number;
  mode: DisplayMode;
  assignment: AxisAssignment;
  fileName: string;
}

/** Colour and dash of a column, fixed by its position in the file so ticking others never repaints it. */
export function seriesStyle(column: { index: number }, dark: boolean) {
  const palette = dark ? PALETTE_DARK : PALETTE_LIGHT;
  return {
    color: palette[column.index % palette.length],
    dash: DASHES[Math.floor(column.index / palette.length) % DASHES.length],
  };
}

export function buildChartOption(input: ChartInput, theme: ChartTheme): EChartsOption {
  const { x, ys, mode, assignment } = input;
  const xIsTime = x?.kind === "time";
  const source: Record<string, (number | string | null)[]> = { x: xValues(x, input.rowCount) };
  ys.forEach((col, i) => (source[`s${i}`] = toNullable(col.values)));

  const stacked = mode === "stacked";
  const series: LineSeriesOption[] = ys.map((col, i) => {
    const axis = assignment.axisOf[col.name] ?? 0;
    const style = seriesStyle(col, theme.dark);
    return {
      type: "line",
      name: col.name,
      datasetIndex: 0,
      encode: { x: "x", y: `s${i}` },
      yAxisIndex: axis,
      showSymbol: false,
      sampling: "lttb",
      color: style.color,
      lineStyle: { width: stacked ? 1 : 2, type: style.dash },
      emphasis: { focus: "series" },
      ...(stacked
        ? { stack: `axis${axis}`, stackStrategy: "samesign", areaStyle: { opacity: 0.55 } }
        : {}),
    };
  });

  const yAxis: YAXisComponentOption[] = assignment.axes.map((axis, i) => {
    const firstMember = ys.find((c) => c.name === axis.members[0]);
    const lineColor = firstMember
      ? seriesStyle(firstMember, theme.dark).color
      : theme.mutedForeground;
    return {
      type: "value",
      name: axis.labels.join(", "),
      nameTextStyle: { color: theme.foreground },
      position: i === 0 ? "left" : "right",
      offset: i <= 1 ? 0 : (i - 1) * 64,
      scale: !stacked,
      alignTicks: i > 0,
      axisLine: { show: true, lineStyle: { color: lineColor, width: 2 } },
      axisLabel: { color: theme.mutedForeground },
      splitLine: { show: i === 0, lineStyle: { color: "rgba(128,128,128,0.22)" } },
    };
  });
  if (yAxis.length === 0) yAxis.push({ type: "value" });

  const rightAxes = Math.max(0, assignment.axes.length - 1);
  const tooltipContext: TooltipContext = {
    x,
    ys,
    colors: ys.map((c) => seriesStyle(c, theme.dark).color),
    rowCount: input.rowCount,
    xSorted: !x || (x.kind !== "text" && isMonotonic(x.values)),
  };
  const timeSuffix = xIsTime && (x as NumericColumn).hasOffset ? " (UTC)" : "";

  return {
    animation: false,
    useUTC: true,
    backgroundColor: "transparent",
    textStyle: { fontFamily: theme.fontFamily, color: theme.foreground },
    dataset: { source },
    grid: { left: 64, right: rightAxes === 0 ? 32 : 64 * rightAxes, top: 76, bottom: 84 },
    legend: { type: "scroll", top: 4, left: 8, right: 120, textStyle: { color: theme.foreground } },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      confine: true,
      formatter: (params) => tooltipHtml(params, tooltipContext),
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
          name: input.fileName.replace(/\.[^.]+$/, ""),
          backgroundColor: theme.background,
        },
      },
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none" },
      { type: "slider", xAxisIndex: 0, height: 22, bottom: 10, filterMode: "none" },
    ],
    xAxis: {
      type: !x ? "value" : x.kind === "time" ? "time" : x.kind === "number" ? "value" : "category",
      name: (x ? x.name : "row") + timeSuffix,
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: theme.foreground },
      min: x?.kind === "text" ? undefined : "dataMin",
      max: x?.kind === "text" ? undefined : "dataMax",
      axisLabel: { color: theme.mutedForeground, hideOverlap: true },
      axisLine: { lineStyle: { color: theme.mutedForeground } },
      splitLine: { show: false },
    },
    yAxis,
    series,
  };
}

function xValues(x: Column | null, rowCount: number): (number | string | null)[] {
  if (!x) return Array.from({ length: rowCount }, (_, i) => i + 1);
  if (x.kind === "text") return x.values;
  return toNullable(x.values);
}

function toNullable(values: Float64Array): (number | null)[] {
  const out = new Array<number | null>(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Number.isNaN(values[i]) ? null : values[i];
  return out;
}

/** True when the non-missing values never decrease (file order matches X order). */
export function isMonotonic(values: Float64Array): boolean {
  let last = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (v < last) return false;
    last = v;
  }
  return true;
}
