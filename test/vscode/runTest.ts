// Downloads VS Code (cached in .vscode-test/), installs Rainbow CSV next to this extension and
// runs the integration suite. Needs a display (WSLg on Windows, or xvfb-run on a headless Linux).
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";

/**
 * Variables that make a nested VS Code misbehave when the tests are started from a VS Code
 * terminal: ELECTRON_RUN_AS_NODE turns it into plain Node, VSCODE_* route the CLI to the
 * running (remote) instance instead of the downloaded one.
 */
function inheritedVsCodeVariables(): string[] {
  return Object.keys(process.env).filter(
    (k) => k === "ELECTRON_RUN_AS_NODE" || k.startsWith("VSCODE_"),
  );
}

async function main(): Promise<void> {
  const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
  const unset: Record<string, undefined> = {};
  for (const key of inheritedVsCodeVariables()) {
    delete cleanEnv[key];
    unset[key] = undefined;
  }
  // The Linux VS Code launcher otherwise stops at a "VS Code inside WSL?" prompt.
  cleanEnv.DONT_PROMPT_WSL_INSTALL = "1";
  const root = path.resolve(__dirname, "../../..");
  const fixtures = path.join(root, "out", "fixtures");
  const extensionsDir = path.join(root, ".vscode-test", "extensions");
  spawnSync(
    process.execPath,
    [path.join(root, "test", "fixtures", "make-fixtures.mjs"), fixtures],
    {
      stdio: "inherit",
    },
  );

  const vscodeExecutablePath = await downloadAndUnzipVSCode("stable");
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  fs.mkdirSync(extensionsDir, { recursive: true });
  spawnSync(
    cli,
    [
      ...cliArgs,
      "--extensions-dir",
      extensionsDir,
      "--install-extension",
      "mechatroner.rainbow-csv",
    ],
    { stdio: "inherit", encoding: "utf8", env: cleanEnv },
  );

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, "suite"),
    launchArgs: [fixtures, "--extensions-dir", extensionsDir, "--disable-workspace-trust"],
    extensionTestsEnv: unset,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
