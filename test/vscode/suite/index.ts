// Integration tests, run inside a real VS Code instance by runTest.ts.
import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

const VIEW_TYPE = "csvPlot.graph";
const EXCEL_VIEW_TYPE = "csvPlot.excelGraph";

function fixture(name: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders![0].uri;
  return vscode.Uri.file(path.join(folder.fsPath, name));
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface ViewStatus {
  overlay: string | null;
  sheets?: string[];
  sheet?: string;
  series: string[];
  rows: number;
}
/** What the graph view of `uri` reports it shows (see CsvPlotApi in src/extension). */
async function viewStatus(uri: vscode.Uri): Promise<ViewStatus | undefined> {
  const ext = vscode.extensions.getExtension<{ viewStatus(u: vscode.Uri): ViewStatus | undefined }>(
    "harrahx3.vscode-csv-plot",
  )!;
  return (await ext.activate()).viewStatus(uri);
}
async function waitForChart(uri: vscode.Uri): Promise<ViewStatus> {
  const start = Date.now();
  for (;;) {
    const status = await viewStatus(uri);
    if (status && status.overlay === null) return status;
    if (Date.now() - start > 20_000)
      throw new Error(`no chart drawn; view shows: ${status?.overlay ?? "(nothing reported)"}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const allTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs);
const tabsOf = (uri: vscode.Uri) =>
  allTabs().filter((t) => {
    const input = t.input;
    return (
      (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) &&
      input.uri.toString() === uri.toString()
    );
  });
const activeInput = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;
const isGraph = (input: unknown, viewType = VIEW_TYPE) =>
  input instanceof vscode.TabInputCustom && input.viewType === viewType;

const tests: [string, () => Promise<void>][] = [
  [
    "a CSV opens in the plain text editor by default, with Rainbow CSV's language",
    async () => {
      const uri = fixture("hourly_semicolon.csv");
      await vscode.commands.executeCommand("vscode.open", uri);
      await waitFor(() => activeInput() instanceof vscode.TabInputText, "text editor");
      const rainbow = vscode.extensions.getExtension("mechatroner.rainbow-csv");
      if (rainbow) {
        await waitFor(
          () => /csv/i.test(vscode.window.activeTextEditor?.document.languageId ?? ""),
          "a CSV language id from Rainbow CSV",
        );
      } else {
        console.warn(
          "    (Rainbow CSV not installed in the test instance: language check skipped)",
        );
      }
    },
  ],
  [
    "Open as Graph replaces the raw tab with the graph view",
    async () => {
      const uri = fixture("hourly_semicolon.csv");
      await vscode.commands.executeCommand("csvPlot.openGraph");
      await waitFor(() => isGraph(activeInput()), "graph view");
      await waitFor(() => tabsOf(uri).length === 1, "a single tab for the file");
      assert.ok(vscode.extensions.getExtension("harrahx3.vscode-csv-plot")?.isActive);
      const status = await waitForChart(uri);
      assert.strictEqual(status.rows, 8760);
    },
  ],
  [
    "Show Raw CSV goes back to the text editor in a single tab, language kept",
    async () => {
      const uri = fixture("hourly_semicolon.csv");
      await vscode.commands.executeCommand("csvPlot.showRaw");
      await waitFor(() => activeInput() instanceof vscode.TabInputText, "text editor");
      await waitFor(() => tabsOf(uri).length === 1, "a single tab for the file");
      const doc = vscode.window.activeTextEditor!.document;
      assert.strictEqual(doc.uri.toString(), uri.toString());
      if (vscode.extensions.getExtension("mechatroner.rainbow-csv"))
        assert.match(doc.languageId, /csv/i);
    },
  ],
  [
    "toggling keeps unsaved edits and does not close a dirty tab",
    async () => {
      const uri = fixture("plain_comma.csv");
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      await editor.edit((e) => e.insert(new vscode.Position(1, 0), "9,9,9,x\n"));
      await vscode.commands.executeCommand("csvPlot.openGraph", uri);
      await waitFor(() => isGraph(activeInput()), "graph view");
      assert.ok(doc.isDirty, "edit kept");
      await vscode.commands.executeCommand("csvPlot.showRaw");
      await waitFor(() => activeInput() instanceof vscode.TabInputText, "text editor");
      assert.ok(doc.getText().includes("9,9,9,x"));
      await vscode.commands.executeCommand("workbench.action.files.revert");
    },
  ],
  [
    "the graph view is offered in 'Reopen Editor With' (registered custom editor)",
    async () => {
      const pkg = vscode.extensions.getExtension("harrahx3.vscode-csv-plot")!.packageJSON;
      const editor = pkg.contributes.customEditors[0];
      assert.strictEqual(editor.viewType, VIEW_TYPE);
      assert.strictEqual(editor.priority, "option");
    },
  ],
  [
    "an Excel workbook opens directly in the Excel graph view",
    async () => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      const uri = fixture("plant.xlsx");
      await vscode.commands.executeCommand("vscode.open", uri);
      await waitFor(() => isGraph(activeInput(), EXCEL_VIEW_TYPE), "Excel graph view");
      assert.strictEqual(tabsOf(uri).length, 1);
      const status = await waitForChart(uri);
      assert.strictEqual(status.sheet, "Hourly");
      assert.deepStrictEqual(status.sheets, ["Readme", "Hourly", "Daily", "Lookup"]);
      assert.deepStrictEqual(status.series, ["q_demand_kw"]);
      assert.strictEqual(status.rows, 8760);
    },
  ],
  [
    "a legacy .xls workbook opens in the Excel graph view too",
    async () => {
      const uri = fixture("plant.xls");
      await vscode.commands.executeCommand("vscode.open", uri);
      await waitFor(() => isGraph(activeInput(), EXCEL_VIEW_TYPE), "Excel graph view");
      assert.strictEqual(tabsOf(uri).length, 1);
      const status = await waitForChart(uri);
      assert.strictEqual(status.sheet, "Hourly");
      assert.strictEqual(status.rows, 8760);
    },
  ],
  [
    "a workbook whose name has accents and spaces is read",
    async () => {
      const uri = fixture("résultats - Copy.xlsx");
      await vscode.commands.executeCommand("vscode.open", uri);
      await waitFor(() => isGraph(activeInput(), EXCEL_VIEW_TYPE), "Excel graph view");
      assert.strictEqual((await waitForChart(uri)).rows, 100);
    },
  ],
  [
    "Reload Workbook and Open as Graph work on a workbook",
    async () => {
      const uri = fixture("plant.xlsx");
      await vscode.commands.executeCommand("csvPlot.reload");
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.commands.executeCommand("csvPlot.openGraph", uri);
      await waitFor(() => isGraph(activeInput(), EXCEL_VIEW_TYPE), "Excel graph view");
      assert.strictEqual(tabsOf(uri).length, 1);
    },
  ],
];

export async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
    }
  }
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  if (failed) throw new Error(`${failed} integration test(s) failed`);
}
