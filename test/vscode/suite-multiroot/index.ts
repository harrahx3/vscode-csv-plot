// Multi-root workspace tests: folders "alpha" and "beta" each hold hourly_semicolon.csv.
import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

const VIEW_TYPE = "csvPlot.graph";

const fixture = (folder: string, name: string) =>
  vscode.Uri.file(
    path.join(vscode.workspace.workspaceFolders!.find((f) => f.name === folder)!.uri.fsPath, name),
  );

async function waitFor(check: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface ViewStatus {
  overlay: string | null;
  rows: number;
  series: string[];
}
async function waitForChart(uri: vscode.Uri): Promise<ViewStatus> {
  const ext = vscode.extensions.getExtension<{ viewStatus(u: vscode.Uri): ViewStatus | undefined }>(
    "harrahx3.vscode-csv-plot",
  )!;
  const api = await ext.activate();
  const start = Date.now();
  for (;;) {
    const status = api.viewStatus(uri);
    if (status && status.overlay === null) return status;
    if (Date.now() - start > 20_000)
      throw new Error(`no chart drawn; view shows: ${status?.overlay ?? "(nothing reported)"}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const tabsOf = (uri: vscode.Uri) =>
  vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter(
      (t) => t.input instanceof vscode.TabInputCustom && t.input.uri.toString() === uri.toString(),
    );

const tests: [string, () => Promise<void>][] = [
  [
    "the workspace has two folders",
    async () => {
      assert.deepStrictEqual(
        vscode.workspace.workspaceFolders!.map((f) => f.name),
        ["alpha", "beta"],
      );
    },
  ],
  [
    "a same-named CSV in each folder opens as its own graph, both drawn",
    async () => {
      const a = fixture("alpha", "hourly_semicolon.csv");
      const b = fixture("beta", "hourly_semicolon.csv");
      assert.notStrictEqual(a.toString(), b.toString());
      await vscode.commands.executeCommand("vscode.openWith", a, VIEW_TYPE);
      await vscode.commands.executeCommand("vscode.openWith", b, VIEW_TYPE);
      await waitFor(() => tabsOf(a).length === 1 && tabsOf(b).length === 1, "one graph per file");
      assert.strictEqual((await waitForChart(a)).rows, 8760);
      assert.strictEqual((await waitForChart(b)).rows, 8760);
    },
  ],
  [
    "closing one folder's graph leaves the other open",
    async () => {
      const a = fixture("alpha", "hourly_semicolon.csv");
      const b = fixture("beta", "hourly_semicolon.csv");
      await vscode.window.tabGroups.close(tabsOf(a));
      await waitFor(() => tabsOf(a).length === 0, "alpha's graph closed");
      assert.strictEqual(tabsOf(b).length, 1);
    },
  ],
  [
    "removing a folder from the workspace does not break the other folder's graph",
    async () => {
      const b = fixture("beta", "hourly_semicolon.csv");
      vscode.workspace.updateWorkspaceFolders(0, 1);
      await waitFor(() => vscode.workspace.workspaceFolders!.length === 1, "one folder left");
      assert.strictEqual(tabsOf(b).length, 1);
      assert.strictEqual((await waitForChart(b)).rows, 8760);
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
