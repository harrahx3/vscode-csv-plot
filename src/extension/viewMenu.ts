// Right-click menu of the graph views (`webview/context`): the commands, and the registry that
// tells them which view was clicked.
import * as vscode from "vscode";
import { env } from "vscode";
import type { HostToWebview, MenuAction, MenuContext, WebviewToHost } from "../shared/messages";

export interface PlotView {
  webview: vscode.Webview;
  uri: vscode.Uri;
  /** Excel views: re-read the workbook. */
  reload?: () => void;
}

const views = new Map<string, PlotView>();
let counter = 0;

/** Registers a graph view; its id goes in the page's right-click context (`plotView`). */
export function registerView(view: PlotView): { id: string; view: PlotView } & vscode.Disposable {
  const id = `view-${++counter}`;
  views.set(id, view);
  return { id, view, dispose: () => views.delete(id) };
}

/** Test hook: the id of the view showing `uri`. */
export function viewIdOf(uri: vscode.Uri): string | undefined {
  for (const [id, v] of views) if (v.uri.toString() === uri.toString()) return id;
  return undefined;
}

/** Messages of a view that ask the host for something: copy to the clipboard, save a file. */
export async function handleViewMessage(msg: WebviewToHost, uri: vscode.Uri): Promise<void> {
  if (msg.type === "copy") {
    await env.clipboard.writeText(msg.text);
    vscode.window.setStatusBarMessage(`$(check) ${msg.what} copied`, 3000);
  } else if (msg.type === "saveImage") {
    const target = await vscode.window.showSaveDialog({
      title: "Save chart as PNG",
      defaultUri: vscode.Uri.joinPath(uri, "..", msg.fileName),
      filters: { "PNG image": ["png"] },
    });
    if (!target) return;
    const base64 = msg.dataUrl.slice(msg.dataUrl.indexOf(",") + 1);
    await vscode.workspace.fs.writeFile(target, Buffer.from(base64, "base64"));
    vscode.window.setStatusBarMessage(
      `$(check) Chart saved to ${target.path.split("/").pop()}`,
      3000,
    );
  }
}

/** Menu commands carried out by the view itself. */
const VIEW_ACTIONS: Record<string, MenuAction> = {
  "csvPlot.menu.lines": "lines",
  "csvPlot.menu.stacked": "stacked",
  "csvPlot.menu.histogram": "histogram",
  "csvPlot.menu.resetZoom": "resetZoom",
  "csvPlot.menu.hidePanel": "hidePanel",
  "csvPlot.menu.showPanel": "showPanel",
  "csvPlot.menu.savePng": "savePng",
  "csvPlot.menu.copyStats": "copyStats",
  "csvPlot.menu.plotOnly": "plotOnly",
  "csvPlot.menu.histogramOf": "histogramOf",
  "csvPlot.menu.useAsX": "useAsX",
};

export function registerMenuCommands(
  context: vscode.ExtensionContext,
  showRaw: (uri: vscode.Uri) => Promise<void>,
): void {
  const viewOf = (ctx?: MenuContext) => (ctx?.plotView ? views.get(ctx.plotView) : undefined);
  const register = (id: string, fn: (ctx?: MenuContext) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  for (const [id, action] of Object.entries(VIEW_ACTIONS)) {
    register(id, (ctx) => {
      const message: HostToWebview = { type: "menu", action, column: ctx?.column };
      return viewOf(ctx)?.webview.postMessage(message);
    });
  }
  register("csvPlot.menu.copyColumnName", async (ctx) => {
    if (ctx?.column === undefined) return;
    await env.clipboard.writeText(ctx.column);
    vscode.window.setStatusBarMessage("$(check) Column name copied", 3000);
  });
  register("csvPlot.menu.showRaw", (ctx) => {
    const view = viewOf(ctx);
    return view && showRaw(view.uri);
  });
  register("csvPlot.menu.reload", (ctx) => viewOf(ctx)?.reload?.());
}
