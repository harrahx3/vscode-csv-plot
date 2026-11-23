import * as vscode from "vscode";

/** Allows the bundled scripts only and loads the graph view page. */
export function initWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  viewId: string,
): void {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
  };
  webview.html = webviewHtml(webview, extensionUri, viewId);
}

/**
 * HTML shell of the graph view, with a strict Content-Security-Policy (bundled scripts only).
 * The body's right-click context hides the default Cut/Copy/Paste items (text fields bring them
 * back) and names the view, so the menu commands know which one was clicked.
 */
export function webviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  viewId: string,
): string {
  const menuContext = JSON.stringify({ preventDefaultContextMenuItems: true, plotView: viewId });
  const asset = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", file));
  const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    "",
  );
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data: blob:`,
    // ECharts' tooltip writes inline style attributes.
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${asset("webview.css")}">
  <title>CSV &amp; Excel Plot</title>
</head>
<body data-vscode-context='${menuContext}'>
  <div id="app">
    <aside id="panel"></aside>
    <div id="resizer" title="Drag to resize"></div>
    <div id="chart-wrap">
      <button id="expand" class="icon" title="Show panel">⟩</button>
      <div id="chart"></div>
      <aside id="stats" hidden></aside>
      <div id="overlay"><p>Loading…</p></div>
    </div>
  </div>
  <script nonce="${nonce}" src="${asset("webview.js")}"></script>
</body>
</html>`;
}
