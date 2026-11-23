/** Right-click menu of the view: what each item changes, and the context it is opened with. */
import type { MenuAction, MenuContext, PlotState } from "../shared/messages";

/** Text fields keep the default Cut/Copy/Paste menu that the page hides elsewhere. */
export const KEEP_DEFAULT_MENU = JSON.stringify({ preventDefaultContextMenuItems: false });

export function setMenuContext(el: HTMLElement, ctx: MenuContext): void {
  el.dataset.vscodeContext = JSON.stringify(ctx);
}

/**
 * The choices a menu item changes, or undefined for the items that act on the chart instead
 * (reset zoom, save, copy). Picking a column from the histogram goes back to the line chart.
 */
export function menuPatch(
  action: MenuAction,
  column: string | undefined,
  state: PlotState,
): Partial<PlotState> | undefined {
  const lineMode = state.mode === "histogram" || !state.mode ? "lines" : state.mode;
  switch (action) {
    case "lines":
    case "stacked":
    case "histogram":
      return { mode: action };
    case "hidePanel":
    case "showPanel":
      return { panelCollapsed: action === "hidePanel" };
    case "plotOnly":
      return column === undefined ? undefined : { ys: [column], axisOverrides: {}, mode: lineMode };
    case "histogramOf":
      return column === undefined
        ? undefined
        : { mode: "histogram", histogram: { ...state.histogram, column } };
    case "useAsX":
      return column === undefined
        ? undefined
        : { x: column, ys: (state.ys ?? []).filter((y) => y !== column), mode: lineMode };
    default:
      return undefined;
  }
}
