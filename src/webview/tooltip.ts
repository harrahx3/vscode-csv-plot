/**
 * Hover tooltip. Built from the full-resolution columns rather than ECharts' own params:
 * with point thinning, ECharts only reports the series whose drawn point is nearest to the
 * cursor, whereas the tooltip must list every plotted column at the hovered X.
 */
import type { Column, NumericColumn } from "./parse/table";

export interface TooltipContext {
  x: Column | null;
  ys: NumericColumn[];
  colors: string[];
  rowCount: number;
  /** X values never decrease (allows a binary search). */
  xSorted: boolean;
}

interface AxisParam {
  axisValue?: number | string;
  dataIndex?: number;
}

export function tooltipHtml(raw: unknown, ctx: TooltipContext): string {
  const params = (Array.isArray(raw) ? raw : [raw]) as AxisParam[];
  const first = params[0];
  if (!first) return "";
  const row = rowAt(first.axisValue, first.dataIndex ?? 0, ctx);
  if (row < 0) return "";
  const header = formatX(xAt(row, ctx), ctx.x);
  const lines = ctx.ys.map((col, i) => {
    const marker = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:${ctx.colors[i]}"></span>`;
    return `${marker}${escapeHtml(col.name)}&nbsp;&nbsp;<b>${formatNumber(col.values[row])}</b>`;
  });
  return [`<b>${escapeHtml(header)}</b>`, ...lines].join("<br/>");
}

/** Row index for the hovered axis value. */
export function rowAt(axisValue: unknown, dataIndex: number, ctx: TooltipContext): number {
  const n = ctx.rowCount;
  if (n === 0) return -1;
  if (!ctx.x) return clamp(Math.round(Number(axisValue)) - 1, n);
  if (ctx.x.kind === "text" || !ctx.xSorted || typeof axisValue !== "number")
    return clamp(dataIndex, n);
  const values = ctx.x.values;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < axisValue) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(values[lo - 1] - axisValue) <= Math.abs(values[lo] - axisValue)) lo--;
  return lo;
}

function clamp(i: number, n: number): number {
  return Number.isFinite(i) ? Math.min(Math.max(i, 0), n - 1) : 0;
}

function xAt(row: number, ctx: TooltipContext): unknown {
  return ctx.x ? ctx.x.values[row] : row + 1;
}

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 6,
  useGrouping: false,
});

export function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? numberFormat.format(value) : "–";
}

export function formatX(value: unknown, x: Column | null): string {
  if (!x) return `row ${value}`;
  if (x.kind === "time" && typeof value === "number") {
    return Number.isNaN(value) ? "–" : formatUtc(value) + (x.hasOffset ? " UTC" : "");
  }
  return typeof value === "number" ? formatNumber(value) : String(value ?? "");
}

/** Formats epoch milliseconds as written in the file: YYYY-MM-DD HH:mm[:ss]. */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  const seconds = d.getUTCSeconds() ? `:${p(d.getUTCSeconds())}` : "";
  return `${date} ${time}${seconds}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
