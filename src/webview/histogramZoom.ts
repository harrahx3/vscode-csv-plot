/**
 * Histogram zoom: zooming in re-bins the visible range, so the bars get narrower and show the
 * detail of that part of the distribution instead of just getting wider.
 */
import type * as echarts from "echarts/core";
import { HIST_SERIES_ID, histogramRows } from "./histogramOption";
import { countBetween, histogram, type Histogram } from "./stats";

export interface ZoomWindow {
  from: number;
  to: number;
  /** Values inside [from, to]. */
  count: number;
}

export interface HistogramView {
  /** Bins to draw: the whole column, or the zoomed range. */
  hist: Histogram;
  /** Zoomed range; undefined when the whole column shows. */
  window?: ZoomWindow;
}

interface Shown {
  column: string;
  sorted: Float64Array;
  targetBins: number;
  /** X axis range of the whole column. */
  extent: [number, number];
}

export class HistogramZoom {
  private shown: Shown | null = null;
  /** Zoomed range, kept while the same column shows (bins or theme change, file edit). */
  private range: { column: string; from: number; to: number } | null = null;
  private frame = 0;

  constructor(
    /** Called after a zoom re-binned the chart. */
    private readonly onZoom: (view: HistogramView) => void,
    /** Called when the zoom is reset from the toolbox: redraw the whole column. */
    private readonly onReset: () => void,
  ) {}

  /** Listens to the chart's zoom events; call once per chart instance. */
  attach(chart: echarts.ECharts): void {
    chart.on("datazoom", () => {
      if (!this.shown) return;
      // Wheel and slider fire many events: re-bin once per frame.
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.zoomed(chart));
    });
    chart.on("restore", () => {
      if (!this.shown) return;
      this.range = null;
      this.onReset();
    });
  }

  /** A column is drawn: returns its bins, for the zoomed range when it is the same column. */
  show(column: string, sorted: Float64Array, targetBins: number, extent: [number, number]) {
    if (this.range?.column !== column) this.range = null;
    this.shown = { column, sorted, targetBins, extent };
    return this.view();
  }

  /** Leaving the histogram: forget the zoom. */
  hide(): void {
    this.shown = null;
    this.range = null;
  }

  private view(): HistogramView {
    const { sorted, targetBins, extent } = this.shown!;
    if (!this.range) return { hist: histogram(sorted, targetBins) };
    const from = Math.max(this.range.from, extent[0]);
    const to = Math.min(this.range.to, extent[1]);
    return {
      hist: histogram(sorted, targetBins, [from, to]),
      window: { from, to, count: countBetween(sorted, from, to) },
    };
  }

  private zoomed(chart: echarts.ECharts): void {
    if (!this.shown) return;
    const zoom = (
      chart.getOption().dataZoom as { start?: number; end?: number }[] | undefined
    )?.[0];
    if (!zoom) return;
    const start = zoom.start ?? 0;
    const end = zoom.end ?? 100;
    const [min, max] = this.shown.extent;
    this.range =
      start <= 0 && end >= 100
        ? null
        : {
            column: this.shown.column,
            from: min + ((max - min) * start) / 100,
            to: min + ((max - min) * end) / 100,
          };
    const view = this.view();
    chart.setOption({ series: [{ id: HIST_SERIES_ID, data: histogramRows(view.hist) }] });
    this.onZoom(view);
  }
}
