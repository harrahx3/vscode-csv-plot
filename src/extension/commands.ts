import * as vscode from "vscode";
import { EXCEL_EXTENSIONS, EXCEL_VIEW_TYPE } from "./excelProvider";
import { VIEW_TYPE } from "./provider";

/** Opens the file of the active tab (or `uri`) in the graph view, replacing the raw tab. */
export async function openGraph(uri?: vscode.Uri): Promise<void> {
  await reopenWith(uri, graphViewType);
}

/** The CSV graph view, or the Excel one for a workbook. */
function graphViewType(uri: vscode.Uri): string {
  const ext = uri.path.slice(uri.path.lastIndexOf(".")).toLowerCase();
  return EXCEL_EXTENSIONS.includes(ext) ? EXCEL_VIEW_TYPE : VIEW_TYPE;
}

/** Reopens the file of the active graph tab (or `uri`) in the default text editor. */
export async function showRaw(uri?: vscode.Uri): Promise<void> {
  await reopenWith(uri, "default");
}

async function reopenWith(
  uri: vscode.Uri | undefined,
  view: string | ((target: vscode.Uri) => string),
): Promise<void> {
  const group = vscode.window.tabGroups.activeTabGroup;
  const target = uri ?? tabUri(group.activeTab) ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    void vscode.window.showInformationMessage("CSV Plot: open a CSV or Excel file first.");
    return;
  }
  const viewType = typeof view === "string" ? view : view(target);
  const previous = group.tabs.find(
    (t) => sameUri(tabUri(t), target) && isView(t, viewType) === false,
  );
  await vscode.commands.executeCommand("vscode.openWith", target, viewType, {
    viewColumn: group.viewColumn,
    preview: false,
  });
  // VS Code keeps the other editor of the same file open as a second tab: close it so the
  // switch feels like a toggle. A tab with unsaved changes is left alone (no save prompt).
  if (previous) {
    const stale = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .find((t) => t.group.viewColumn === previous.group.viewColumn && sameTab(t, previous));
    if (stale && !stale.isDirty && !stale.isActive) await vscode.window.tabGroups.close(stale);
  }
}

function tabUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom)
    return input.uri;
  return undefined;
}

function isView(tab: vscode.Tab, viewType: string): boolean {
  const input = tab.input;
  if (viewType === "default") return input instanceof vscode.TabInputText;
  return input instanceof vscode.TabInputCustom && input.viewType === viewType;
}

function sameUri(a: vscode.Uri | undefined, b: vscode.Uri): boolean {
  return a?.toString() === b.toString();
}

function sameTab(a: vscode.Tab, b: vscode.Tab): boolean {
  if (a.input instanceof vscode.TabInputText && b.input instanceof vscode.TabInputText) {
    return a.input.uri.toString() === b.input.uri.toString();
  }
  if (a.input instanceof vscode.TabInputCustom && b.input instanceof vscode.TabInputCustom) {
    return (
      a.input.uri.toString() === b.input.uri.toString() && a.input.viewType === b.input.viewType
    );
  }
  return false;
}
