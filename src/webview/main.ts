/** Webview entry point: receives the CSV text or the Excel workbook, keeps the user's choices, drives panel and chart. */
import { CustomChart, LineChart } from "echarts/charts";
import {
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { HostToWebview, PlotState, WebviewToHost, WorkbookState } from "../shared/messages";
import { assignAxes } from "./axes";
import { buildChartOption, isMonotonic, seriesStyle, type ChartTheme } from "./chartOptions";
import { buildHistogramOption } from "./histogramOption";
import { HistogramZoom } from "./histogramZoom";
import { initResizer, readTheme } from "./page";
import { Panel } from "./panel";
import { tableFromSheet } from "./parse/sheetTable";
import { parseTable, type Column, type NumericColumn, type Table } from "./parse/table";
import { readWorkbook } from "./parse/readWorkbook";
import type { Workbook } from "./parse/workbook";
import { autoBinCount, columnStats, histogram, sortedValues, type ColumnStats } from "./stats";
import { StatsCard } from "./statsCard";

echarts.use([
  CustomChart,
  LineChart,
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  CanvasRenderer,
]);

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHost): void };
const vscode = acquireVsCodeApi();
const post = (message: WebviewToHost) => vscode.postMessage(message);

const app = document.getElementById("app")!;
const chartEl = document.getElementById("chart")!;
const overlay = document.getElementById("overlay")!;
const expand = document.getElementById("expand")!;

/** The CSV text, or the workbook and the sheet shown. */
let source: { kind: "csv"; text: string } | { kind: "workbook"; book: Workbook } | null = null;
let fileName = "";
/** Choices for the CSV file, or for the current sheet of a workbook. */
let state: PlotState = {};
/** Workbooks only: the current sheet and the choices of the other sheets. */
let bookState: WorkbookState = {};
let sheetNotices: string[] = [];
let table: Table | null = null;
let chart: echarts.ECharts | null = null;
let lastX: string | null | undefined;

const panel = new Panel(document.getElementById("panel")!, {
  sheet: (name) => switchSheet(name),
  separator: (v) => update({ separator: v }, true),
  decimal: (v) => update({ decimal: v }, true),
  mode: (mode) => update({ mode }),
  x: (x) => update({ x, ys: (state.ys ?? []).filter((y) => y !== x) }),
  toggleY: (name, checked) => {
    const ys = (state.ys ?? []).filter((y) => y !== name);
    const overrides = { ...state.axisOverrides };
    if (checked) ys.push(name);
    else delete overrides[name];
    update({ ys, axisOverrides: overrides });
  },
  clearYs: () => update({ ys: [], axisOverrides: {} }),
  axis: (name, axis) => {
    const overrides = { ...state.axisOverrides };
    if (axis === undefined) delete overrides[name];
    else overrides[name] = axis;
    update({ axisOverrides: overrides });
  },
  histColumn: (column) => update({ histogram: { ...state.histogram, column } }),
  collapse: (collapsed) => update({ panelCollapsed: collapsed }),
});
const statsCard = new StatsCard(document.getElementById("stats")!, (bins) =>
  update({ histogram: { ...state.histogram, bins } }),
);
let histStats: ColumnStats | null = null;
const histZoom = new HistogramZoom(
  (view) =>
    histStats &&
    statsCard.renderZoom({
      stats: histStats,
      binCount: view.hist.counts.length,
      zoom: view.window,
    }),
  () => render(),
);
/** Sorted finite values per column, so changing the bins does not sort again. */
const sortedCache = new WeakMap<NumericColumn, Float64Array>();
expand.addEventListener("click", () => update({ panelCollapsed: false }));

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const msg = event.data;
  if (msg.type === "load") {
    source = { kind: "csv", text: msg.text };
    fileName = msg.fileName;
    state = msg.state ?? {};
    reparse();
  } else if (msg.type === "update") {
    if (source?.kind !== "csv") return;
    source = { kind: "csv", text: msg.text };
    reparse();
  } else if (msg.type === "loadWorkbook") {
    fileName = msg.fileName;
    bookState = msg.state ?? {};
    openWorkbook(msg.data);
  } else if (msg.type === "updateWorkbook") {
    if (source?.kind === "workbook") openWorkbook(msg.data);
  } else if (msg.type === "error") {
    showOverlay(msg.message);
  } else if (msg.type === "tooLarge") {
    showOverlay(
      `This file is ${msg.sizeMb.toFixed(0)} MB. Plotting it may take a while.`,
      "Plot anyway",
      () => post({ type: "forceLoad" }),
    );
  }
});

/** Reads the workbook bytes and shows the remembered sheet (or the one active in Excel). */
function openWorkbook(received: unknown): void {
  const data = toBytes(received);
  let book: Workbook;
  try {
    book = readWorkbook(data);
  } catch (err) {
    table = null;
    return showOverlay((err as Error).message);
  }
  if (book.sheets.length === 0) return showOverlay("This workbook has no worksheet to plot.");
  source = { kind: "workbook", book };
  const names = book.sheets.map((s) => s.name);
  const sheet = bookState.sheet && names.includes(bookState.sheet) ? bookState.sheet : undefined;
  bookState.sheet = sheet ?? names[book.defaultSheet];
  state = bookState.sheets?.[bookState.sheet] ?? {};
  reparse();
}

/** File bytes as posted by the host: binary, or the JSON form of a Node Buffer. */
function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  const json = data as { type?: string; data?: number[] } | null;
  if (json?.type === "Buffer" && Array.isArray(json.data)) return Uint8Array.from(json.data);
  return new Uint8Array(0);
}

function switchSheet(name: string): void {
  if (source?.kind !== "workbook" || name === bookState.sheet) return;
  const sheets = { ...bookState.sheets, [bookState.sheet!]: state };
  bookState = { sheet: name, sheets };
  state = { ...sheets[name], panelCollapsed: state.panelCollapsed };
  saveState();
  reparse();
}

function update(patch: Partial<PlotState>, needsReparse = false): void {
  state = { ...state, ...patch };
  saveState();
  if (needsReparse) reparse();
  else render();
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveState(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => post({ type: "saveState", state: persistedState() }), 200);
}

function persistedState(): PlotState | WorkbookState {
  if (source?.kind !== "workbook") return state;
  return { sheet: bookState.sheet, sheets: { ...bookState.sheets, [bookState.sheet!]: state } };
}

function reparse(): void {
  showOverlay("Reading the file…");
  // Let the overlay paint before the (possibly long) synchronous parse.
  setTimeout(() => {
    try {
      table = readTable();
    } catch (err) {
      table = null;
      return showOverlay(`Could not read this file: ${(err as Error).message}`);
    }
    normalizeState(table);
    render();
  }, 16);
}

function readTable(): Table {
  if (source?.kind === "workbook") {
    const sheet = source.book.readSheet(bookState.sheet!);
    const n = sheet.formulasWithoutResult;
    sheetNotices = n
      ? [
          `${n} formula cell${n > 1 ? "s have" : " has"} no saved result (the file was written ` +
            "by a tool that does not calculate): open and save it in Excel to see the values.",
        ]
      : [];
    return tableFromSheet(sheet.rows);
  }
  sheetNotices = [];
  return parseTable(source?.text ?? "", { separator: state.separator, decimal: state.decimal });
}

/**
 * Fills in defaults for a first opening. Choices that do not match the current parse (for
 * instance after a wrong separator was picked) are kept in the state and only skipped when
 * drawing, so switching the setting back restores them.
 */
function normalizeState(t: Table): void {
  if (state.x === undefined) state.x = autoX(t);
  if (state.ys === undefined) {
    const first = t.columns.find((c) => c.kind !== "text" && c.name !== state.x);
    state.ys = first ? [first.name] : [];
  }
  state.mode ??= "lines";
}

function autoX(t: Table): string | null {
  return t.columns.find((c) => c.kind === "time")?.name ?? null;
}

function render(): void {
  if (!table) return;
  app.classList.toggle("collapsed", !!state.panelCollapsed);
  const byName = new Map(table.columns.map((c) => [c.name, c]));
  const xName = state.x && byName.has(state.x) ? state.x : state.x === null ? null : autoX(table);
  const x = xName ? byName.get(xName)! : null;
  const ys = (state.ys ?? [])
    .map((n) => byName.get(n))
    .filter((c): c is NumericColumn => !!c && c.kind !== "text" && c.name !== xName);
  const assignment = assignAxes(
    ys.map((c) => ({ name: c.name, maxAbs: c.maxAbs })),
    state.axisOverrides,
  );
  const theme = readTheme();

  const book = source?.kind === "workbook" ? source.book : null;
  panel.render({
    table,
    sheets: book
      ? {
          names: book.sheets.map((s) => s.name),
          hidden: book.sheets.filter((s) => s.hidden).map((s) => s.name),
          active: bookState.sheet!,
        }
      : undefined,
    separatorOverride: state.separator,
    decimalOverride: state.decimal,
    mode: state.mode ?? "lines",
    x: xName,
    ys: ys.map((c) => c.name),
    axisOverrides: state.axisOverrides ?? {},
    assignment,
    notices: state.mode === "histogram" ? sheetNotices : notices(table, x),
    dark: theme.dark,
    histColumn: histColumnName(table),
  });

  const what = book ? "sheet" : "file";
  if (table.columns.length === 0) return showOverlay(`This ${what} has no data to plot.`);
  if (state.mode === "histogram") return drawHistogram(table, theme, what);
  showStats(false);
  if (ys.length === 0) return showOverlay("Tick one or more columns on the left to plot them.");
  hideOverlay();

  const option = buildChartOption(
    {
      x,
      ys,
      rowCount: table.rowCount,
      mode: state.mode ?? "lines",
      assignment,
      // Name of the saved PNG: the file name, plus the sheet for a workbook.
      fileName: book ? `${fileName.replace(/\.[^.]+$/, "")} - ${bookState.sheet}.png` : fileName,
    },
    theme,
  );
  keepZoom(option, xName);
  ensureChart().setOption(option, { notMerge: true });
  lastX = xName;
  reportStatus(
    null,
    ys.map((c) => c.name),
  );
}

function ensureChart(): echarts.ECharts {
  if (!chart) {
    chart = echarts.init(chartEl, null, { renderer: "canvas" });
    histZoom.attach(chart);
    // Exposed for the automated browser tests.
    (window as unknown as { __csvPlotChart: echarts.ECharts }).__csvPlotChart = chart;
  }
  return chart;
}

/** Histogram mode: the remembered column, else the first ticked one, else the first number column. */
function histColumnName(t: Table): string | null {
  const isNumber = (name: string | undefined) =>
    t.columns.some((c) => c.name === name && c.kind === "number");
  const remembered = [state.histogram?.column, ...(state.ys ?? [])].find(isNumber);
  return remembered ?? t.columns.find((c) => c.kind === "number")?.name ?? null;
}

function drawHistogram(t: Table, theme: ChartTheme, what: string): void {
  const name = histColumnName(t);
  const col = t.columns.find((c): c is NumericColumn => c.name === name && c.kind === "number");
  if (!col) {
    showStats(false);
    return showOverlay(`This ${what} has no number column to draw a histogram of.`);
  }
  let sorted = sortedCache.get(col);
  if (!sorted) sortedCache.set(col, (sorted = sortedValues(col.values)));
  const stats = columnStats(col.values, sorted);
  if (stats.count === 0) {
    showStats(false);
    return showOverlay(`"${col.name}" holds no number.`);
  }
  const bins = state.histogram?.bins;
  const targetBins = bins ?? autoBinCount(sorted);
  const full = histogram(sorted, targetBins);
  const extent: [number, number] = [full.start, full.start + full.counts.length * full.width];
  const view = histZoom.show(col.name, sorted, targetBins, extent);
  histStats = stats;
  showStats(true);
  statsCard.render({
    stats,
    binsOverride: bins,
    binCount: view.hist.counts.length,
    zoom: view.window,
  });
  hideOverlay();
  const sheetName = source?.kind === "workbook" ? ` - ${bookState.sheet}` : "";
  const option = buildHistogramOption(
    {
      name: col.name,
      color: seriesStyle(col, theme.dark).color,
      histogram: view.hist,
      stats,
      extent,
      zoom: view.window && [view.window.from, view.window.to],
      baseName: fileName.replace(/\.[^.]+$/, "") + sheetName,
    },
    theme,
  );
  ensureChart().setOption(option, { notMerge: true });
  // The histogram has no zoom to carry over to the line chart.
  lastX = undefined;
  reportStatus(null, [col.name]);
}

function showStats(visible: boolean): void {
  if (!visible) histZoom.hide();
  app.classList.toggle("histogram", visible);
  statsCard.show(visible);
}

function reportStatus(overlayText: string | null, series: string[] = []): void {
  const book = source?.kind === "workbook" ? source.book : null;
  post({
    type: "status",
    status: {
      overlay: overlayText,
      sheets: book?.sheets.map((s) => s.name),
      sheet: book ? bookState.sheet : undefined,
      series,
      rows: table?.rowCount ?? 0,
      mode: state.mode,
    },
  });
}

/** Keeps the zoomed range when only the Y selection or the mode changed. */
function keepZoom(option: echarts.EChartsCoreOption, xName: string | null): void {
  if (!chart || lastX !== xName) return;
  const zooms = chart.getOption()?.dataZoom as { start?: number; end?: number }[] | undefined;
  const current = zooms?.[0];
  if (!current || current.start === undefined) return;
  for (const z of option.dataZoom as { start?: number; end?: number }[]) {
    z.start = current.start;
    z.end = current.end;
  }
}

function notices(t: Table, x: Column | null): string[] {
  const out: string[] = [...sheetNotices];
  if (!t.separator.confident && !state.separator)
    out.push("The separator could not be detected reliably: please check it above.");
  if (!t.decimal.confident && !state.decimal)
    out.push("The decimal mark could not be detected reliably: please check it above.");
  if (x && x.kind !== "text" && !isMonotonic(x.values)) {
    out.push(`"${x.name}" is not sorted: points are drawn in file order.`);
  }
  if (x?.kind === "time" && x.hasOffset) out.push("Times carry a UTC offset and are shown in UTC.");
  return out;
}

function showOverlay(message: string, action?: string, onAction?: () => void): void {
  overlay.replaceChildren(Object.assign(document.createElement("p"), { textContent: message }));
  if (action && onAction) {
    const button = Object.assign(document.createElement("button"), { textContent: action });
    button.addEventListener("click", onAction);
    overlay.append(button);
  }
  overlay.hidden = false;
  reportStatus(message);
}

function hideOverlay(): void {
  overlay.hidden = true;
}

new ResizeObserver(() => chart?.resize()).observe(chartEl);
// Re-render with the new colours when the VS Code theme changes.
new MutationObserver(() => render()).observe(document.body, {
  attributes: true,
  attributeFilter: ["class"],
});
initResizer(app, document.getElementById("resizer")!);
post({ type: "ready" });
