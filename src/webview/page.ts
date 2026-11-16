/** Page helpers of the webview: VS Code theme colours and the panel resize handle. */
import type { ChartTheme } from "./chartOptions";

/** Chart colours and font read from the VS Code theme variables. */
export function readTheme(): ChartTheme {
  const css = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const dark =
    document.body.classList.contains("vscode-dark") ||
    document.body.classList.contains("vscode-high-contrast");
  return {
    dark,
    foreground: v("--vscode-editor-foreground", dark ? "#cccccc" : "#333333"),
    mutedForeground: v("--vscode-descriptionForeground", dark ? "#a0a0a0" : "#6c6c6c"),
    background: v("--vscode-editor-background", dark ? "#1e1e1e" : "#ffffff"),
    fontFamily: v("--vscode-font-family", "sans-serif"),
  };
}

/** Lets the user drag the handle between the panel and the chart to resize the panel. */
export function initResizer(app: HTMLElement, handle: HTMLElement): void {
  handle.addEventListener("pointerdown", (down) => {
    handle.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => {
      const width = Math.min(Math.max(e.clientX, 180), window.innerWidth * 0.6);
      app.style.setProperty("--panel-width", `${width}px`);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
}
