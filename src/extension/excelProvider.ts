import * as path from "path";
import * as vscode from "vscode";
import type { HostToWebview, WebviewToHost, WorkbookState } from "../shared/messages";
import { initWebview } from "./html";
import type { StateStore } from "./stateStore";
import type { StatusBoard } from "./statusBoard";
import { handleViewMessage, registerView } from "./viewMenu";

export const EXCEL_VIEW_TYPE = "csvPlot.excelGraph";
export const EXCEL_EXTENSIONS = [".xlsx", ".xlsm", ".xls"];
const RELOAD_DELAY_MS = 500;

/**
 * Graph view of an Excel workbook (read-only). The file bytes are sent to the webview, which
 * reads the workbook, so a big file never blocks the extension host. The view reloads when the
 * file changes on disk (for instance when it is saved from Excel).
 */
export class ExcelGraphProvider implements vscode.CustomReadonlyEditorProvider {
  private readonly reloaders = new Map<vscode.WebviewPanel, () => void>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly states: StateStore,
    private readonly statuses: StatusBoard,
  ) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  /** Re-reads the file of the active Excel graph view (file watchers can miss Windows drives). */
  reloadActive(): void {
    for (const [panel, reload] of this.reloaders) if (panel.active) reload();
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    const { uri } = document;
    const webview = panel.webview;
    const view = registerView({ webview, uri });
    initWebview(webview, this.extensionUri, view.id);
    const post = (message: HostToWebview) => void webview.postMessage(message);
    const fileName = path.basename(uri.path);

    const read = async (): Promise<Uint8Array | undefined> => {
      try {
        // A plain Uint8Array copy: VS Code recognises typed arrays by class name when it sends
        // a message to a webview, so a Node Buffer (what readFile can return) would arrive as
        // JSON ({type: "Buffer", data: [...]}) instead of binary data.
        return new Uint8Array(await vscode.workspace.fs.readFile(uri));
      } catch (err) {
        post({ type: "error", message: `Could not read ${fileName}: ${(err as Error).message}` });
        return undefined;
      }
    };
    const load = async (force = false) => {
      const limit = vscode.workspace.getConfiguration("csvPlot").get<number>("confirmAboveMB", 50);
      if (!force && limit > 0) {
        const stat = await Promise.resolve(vscode.workspace.fs.stat(uri)).catch(() => undefined);
        const sizeMb = (stat?.size ?? 0) / 1_000_000;
        if (sizeMb > limit) return post({ type: "tooLarge", sizeMb });
      }
      const data = await read();
      if (data) {
        post({ type: "loadWorkbook", data, fileName, state: this.states.get<WorkbookState>(uri) });
      }
    };

    let loaded = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      if (!loaded) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const data = await read();
        if (data) post({ type: "updateWorkbook", data });
      }, RELOAD_DELAY_MS);
    };
    this.reloaders.set(panel, reload);
    view.view.reload = reload;

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(uri, ".."), fileName),
    );
    const subscriptions = [
      watcher,
      // Excel saves through a temporary file and a rename: watch creations too.
      watcher.onDidChange(reload),
      watcher.onDidCreate(reload),
      webview.onDidReceiveMessage((msg: WebviewToHost) => {
        if (msg.type === "ready") void load();
        else if (msg.type === "forceLoad") void load(true);
        else if (msg.type === "saveState") void this.states.set(uri, msg.state);
        else if (msg.type === "status") this.statuses.set(uri, msg.status);
        else void handleViewMessage(msg, uri);
        if (msg.type === "ready" || msg.type === "forceLoad") loaded = true;
      }),
    ];
    panel.onDidDispose(() => {
      clearTimeout(timer);
      this.reloaders.delete(panel);
      view.dispose();
      subscriptions.forEach((s) => s.dispose());
    });
  }
}
