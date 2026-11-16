// Bundles the extension host code (CommonJS, Node) and the webview code (IIFE, browser).
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : "linked",
  logLevel: "info",
};

const builds = [
  {
    ...common,
    entryPoints: ["src/extension/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
  },
  {
    ...common,
    entryPoints: ["src/webview/main.ts"],
    outfile: "dist/webview.js",
    platform: "browser",
    format: "iife",
    target: "es2022",
  },
  {
    ...common,
    entryPoints: ["src/webview/style.css"],
    outfile: "dist/webview.css",
  },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
