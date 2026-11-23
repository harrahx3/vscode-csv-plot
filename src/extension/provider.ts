import * as path from "path";
import * as vscode from "vscode";
import type { HostToWebview, PlotState, WebviewToHost } from "../shared/messages";
import { initWebview } from "./html";
import type { StateStore } from "./stateStore";
import type { StatusBoard } from "./statusBoard";
import { handleViewMessage, registerView } from "./viewMenu";

export const VIEW_TYPE = "csvPlot.graph";
const UPDATE_DELAY_MS = 400;

/**
 * Graph view of a CSV file. Registered with priority "option", so the normal text editor
 * (and extensions such as Rainbow CSV) stays the default for CSV files.
 */
export class GraphEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly states: StateStore,
    private readonly statuses: StatusBoard,
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const webview = panel.webview;
    const view = registerView({ webview, uri: document.uri });
    initWebview(webview, this.extensionUri, view.id);
    const post = (message: HostToWebview) => void webview.postMessage(message);

    const load = (force = false) => {
      const text = document.getText();
      const sizeMb = text.length / 1_000_000;
      const limit = vscode.workspace.getConfiguration("csvPlot").get<number>("confirmAboveMB", 50);
      if (!force && limit > 0 && sizeMb > limit) return post({ type: "tooLarge", sizeMb });
      post({
        type: "load",
        text,
        fileName: path.basename(document.uri.path),
        state: this.states.get<PlotState>(document.uri),
      });
    };

    let loaded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscriptions = [
      webview.onDidReceiveMessage((msg: WebviewToHost) => {
        if (msg.type === "ready") load();
        else if (msg.type === "forceLoad") load(true);
        else if (msg.type === "saveState") void this.states.set(document.uri, msg.state);
        else if (msg.type === "status") this.statuses.set(document.uri, msg.status);
        else void handleViewMessage(msg, document.uri);
        if (msg.type === "ready" || msg.type === "forceLoad") loaded = true;
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== document.uri.toString() || !loaded) return;
        clearTimeout(timer);
        timer = setTimeout(
          () => post({ type: "update", text: document.getText() }),
          UPDATE_DELAY_MS,
        );
      }),
    ];
    panel.onDidDispose(() => {
      clearTimeout(timer);
      view.dispose();
      subscriptions.forEach((s) => s.dispose());
    });
  }
}
