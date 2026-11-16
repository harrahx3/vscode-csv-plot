import * as vscode from "vscode";
import type { ViewStatus } from "../shared/messages";
import { openGraph, showRaw } from "./commands";
import { EXCEL_VIEW_TYPE, ExcelGraphProvider } from "./excelProvider";
import { GraphEditorProvider, VIEW_TYPE } from "./provider";
import { StateStore } from "./stateStore";
import { StatusBoard } from "./statusBoard";

/** Returned by activate(): lets the integration tests see what a graph view shows. */
export interface CsvPlotApi {
  viewStatus(uri: vscode.Uri): ViewStatus | undefined;
}

export function activate(context: vscode.ExtensionContext): CsvPlotApi {
  const states = new StateStore(context.globalState);
  const statuses = new StatusBoard();
  const provider = new GraphEditorProvider(context.extensionUri, states, statuses);
  const excelProvider = new ExcelGraphProvider(context.extensionUri, states, statuses);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerCustomEditorProvider(EXCEL_VIEW_TYPE, excelProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("csvPlot.openGraph", openGraph),
    vscode.commands.registerCommand("csvPlot.reload", () => excelProvider.reloadActive()),
    vscode.commands.registerCommand("csvPlot.showRaw", showRaw),
  );
  return { viewStatus: (uri) => statuses.get(uri) };
}

export function deactivate(): void {}
