/** Messages and persisted state shared by the extension host and the webview. */

export type DisplayMode = "lines" | "stacked" | "histogram";

/** What the user chose for one file; persisted per file URI by the extension host. */
export interface PlotState {
  /** Separator chosen by hand; undefined = automatic detection. */
  separator?: string;
  /** Decimal mark chosen by hand; undefined = automatic detection. */
  decimal?: string;
  /** X column name; null = row number; undefined = automatic choice. */
  x?: string | null;
  /** Ticked Y column names, in tick order. */
  ys?: string[];
  /** Manual Y-axis choice per column (1-based axis number). */
  axisOverrides?: Record<string, number>;
  mode?: DisplayMode;
  /** Histogram mode: the column shown and the number of bins (undefined = automatic). */
  histogram?: { column?: string; bins?: number };
  panelCollapsed?: boolean;
}

/** What the user chose for one Excel workbook: the sheet shown, and the choices per sheet. */
export interface WorkbookState {
  sheet?: string;
  sheets?: Record<string, PlotState>;
}

/** What a right-click menu item asks the view to do (see `src/extension/viewMenu.ts`). */
export type MenuAction =
  | "lines"
  | "stacked"
  | "histogram"
  | "resetZoom"
  | "hidePanel"
  | "showPanel"
  | "savePng"
  | "copyStats"
  | "plotOnly"
  | "histogramOf"
  | "useAsX";

/**
 * Right-click context of the view (`data-vscode-context`): every key becomes a context key for
 * the `webview/context` menu, and the whole object is the argument of the command picked.
 */
export interface MenuContext {
  /** The view the menu was opened in (set on the page body by the extension host). */
  plotView?: string;
  webviewSection?: "chart" | "column" | "stats";
  /** Chart: the display mode, whether a chart (not a message) is shown, and the panel state. */
  mode?: DisplayMode;
  hasChart?: boolean;
  statsShown?: boolean;
  panelHidden?: boolean;
  /** Column row of the panel. */
  column?: string;
  plottable?: boolean;
  isNumber?: boolean;
  isX?: boolean;
}

export type HostToWebview =
  | { type: "load"; text: string; fileName: string; state: PlotState }
  | { type: "update"; text: string }
  | { type: "loadWorkbook"; data: Uint8Array; fileName: string; state: WorkbookState }
  | { type: "updateWorkbook"; data: Uint8Array }
  | { type: "tooLarge"; sizeMb: number }
  | { type: "error"; message: string }
  | { type: "menu"; action: MenuAction; column?: string };

/** What the view shows, reported to the host (read by the integration tests). */
export interface ViewStatus {
  /** Message covering the chart (error, hint, loading), or null when a chart is drawn. */
  overlay: string | null;
  sheets?: string[];
  sheet?: string;
  series: string[];
  rows: number;
  mode?: DisplayMode;
}

export type WebviewToHost =
  | { type: "ready" }
  | { type: "status"; status: ViewStatus }
  | { type: "saveState"; state: PlotState | WorkbookState }
  | { type: "forceLoad" }
  /** Right-click menu results the host carries out: clipboard and save dialog. */
  | { type: "copy"; text: string; what: string }
  | { type: "saveImage"; dataUrl: string; fileName: string };
