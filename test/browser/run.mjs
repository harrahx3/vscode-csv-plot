// Drives the real webview bundle in headless Chromium with a fake VS Code host.
// Usage: npm run test:browser [-- --chromium=<path-to-chrome>]
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { hourlySemicolon, large, plainComma } from "../fixtures/make-fixtures.mjs";
import { hourlyXls } from "../fixtures/make-xls.mjs";
import { hourlyWorkbook, makeXlsx } from "../fixtures/make-xlsx.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const shots = join(root, "test", "browser", "screenshots");
mkdirSync(shots, { recursive: true });

/** Chromium from --chromium=<path>, else the newest one in Playwright's browser cache. */
function chromiumPath() {
  const arg = process.argv.find((a) => a.startsWith("--chromium="));
  if (arg) return arg.slice("--chromium=".length);
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dirs = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort()
    : [];
  for (const d of dirs.reverse()) {
    const exe = join(cache, d, "chrome-linux64", "chrome");
    if (existsSync(exe)) return exe;
  }
  throw new Error(
    "No Chromium found: pass --chromium=<path> or run `npx playwright-core install chromium`.",
  );
}

const DARK_VARS = `
  --vscode-editor-background:#1e1e1e; --vscode-editor-foreground:#d4d4d4; --vscode-foreground:#cccccc;
  --vscode-descriptionForeground:#9d9d9d; --vscode-font-family:sans-serif; --vscode-font-size:13px;
  --vscode-sideBar-background:#252526; --vscode-dropdown-background:#3c3c3c; --vscode-dropdown-foreground:#f0f0f0;
  --vscode-input-background:#3c3c3c; --vscode-input-foreground:#cccccc; --vscode-button-background:#0e639c;
  --vscode-button-foreground:#ffffff; --vscode-textLink-foreground:#3794ff; --vscode-panel-border:#444;`;

function page(theme) {
  const js = readFileSync(join(root, "dist", "webview.js"), "utf8");
  const css = readFileSync(join(root, "dist", "webview.css"), "utf8");
  const vars =
    theme === "dark"
      ? DARK_VARS
      : "--vscode-editor-background:#ffffff; --vscode-editor-foreground:#333; --vscode-foreground:#333;";
  // Same policy as the real webview (src/extension/html.ts), with inline assets allowed by nonce.
  const csp =
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'nonce-test'";
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html{${vars}}</style><style>${css}</style></head>
<body class="vscode-${theme}">
  <div id="app"><aside id="panel"></aside><div id="resizer"></div>
  <div id="chart-wrap"><button id="expand" class="icon">⟩</button><div id="chart"></div><aside id="stats" hidden></aside><div id="overlay"><p>Loading…</p></div></div></div>
  <script nonce="test">window.__sent=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__sent.push(m)});
    document.addEventListener("securitypolicyviolation", (e) => console.error("CSP violation: " + e.violatedDirective));</script>
  <script nonce="test">${js.replace(/<\/script/g, "<\\/script")}</script>
</body></html>`;
}

const browser = await chromium.launch({ executablePath: chromiumPath() });
let failures = 0;

async function scenario(name, fn, theme = "dark") {
  const p = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.setContent(page(theme));
  try {
    await fn(p);
    assert.deepEqual(errors, [], "no page errors");
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n    ${e.message.split("\n").join("\n    ")}`);
    await p.screenshot({ path: join(shots, `FAILED-${name.replace(/\W+/g, "_")}.png`) });
  }
  await p.close();
}

const load = (p, text, state = {}) =>
  p.evaluate(
    ([text, state]) => window.postMessage({ type: "load", text, fileName: "data.csv", state }, "*"),
    [text, state],
  );
const loadWorkbook = (p, bytes, state = {}, type = "loadWorkbook") =>
  p.evaluate(
    ([data, state, type]) =>
      window.postMessage({ type, data: new Uint8Array(data), fileName: "plant.xlsx", state }, "*"),
    [Array.from(bytes), state, type],
  );
const option = (p) => p.evaluate(() => window.__csvPlotChart?.getOption());
const waitChart = (p) =>
  p.waitForFunction(() => window.__csvPlotChart && document.getElementById("overlay").hidden);
const tick = (p, name) =>
  p.locator(".y-list li", { hasText: name }).locator("input[type=checkbox]").check();

console.log("browser tests");

await scenario("hourly semicolon file: detection, time axis, default selection", async (p) => {
  await load(p, hourlySemicolon());
  await waitChart(p);
  const selects = p.locator(".settings select");
  assert.match(await selects.nth(0).locator("option:checked").textContent(), /semicolon/);
  assert.match(await selects.nth(1).locator("option:checked").textContent(), /comma/);
  assert.equal(await p.locator("#x-select").inputValue(), "timestamp");
  const o = await option(p);
  assert.equal(o.xAxis[0].type, "time");
  assert.deepEqual(
    o.series.map((s) => s.name),
    ["q_demand_kw"],
  );
  assert.equal(o.dataset[0].source.s0.length, 8760);
  assert.equal(o.dataset[0].source.s0[0], 200);
  assert.equal(await p.locator(".y-list li.disabled", { hasText: "comment" }).count(), 1);
  assert.equal(await p.locator(".notice").count(), 0);
});

await scenario("multiple Y axes grouped by unit suffix, override and stacked mode", async (p) => {
  await load(p, hourlySemicolon());
  await waitChart(p);
  await tick(p, "q_hp_kw");
  await tick(p, "t_out_c");
  await tick(p, "mdot_kg_per_s");
  let o = await option(p);
  assert.equal(o.yAxis.length, 3);
  assert.deepEqual(
    o.series.map((s) => s.yAxisIndex),
    [0, 0, 1, 2],
  );
  assert.deepEqual(
    o.yAxis.map((a) => a.name),
    ["kw", "c", "kg_per_s"],
  );
  // Move q_hp_kw to a new axis by hand.
  await p
    .locator(".y-list li", { hasText: "q_hp_kw" })
    .locator("select.axis-tag")
    .selectOption({ label: "New axis" });
  o = await option(p);
  assert.equal(o.yAxis.length, 4);
  assert.equal(o.series.find((s) => s.name === "q_hp_kw").yAxisIndex, 3);
  // Back to automatic.
  await p
    .locator(".y-list li", { hasText: "q_hp_kw" })
    .locator("select.axis-tag")
    .selectOption({ index: 0 });
  await p.click("button[data-mode=stacked]");
  o = await option(p);
  assert.deepEqual(
    o.series.map((s) => s.stack),
    ["axis0", "axis0", "axis1", "axis2"],
  );
  await p.screenshot({ path: join(shots, "stacked-dark.png") });
  const saved = await p.evaluate(() => window.__sent.filter((m) => m.type === "saveState").at(-1));
  assert.equal(saved.state.mode, "stacked");
  assert.deepEqual(saved.state.ys, ["q_demand_kw", "q_hp_kw", "t_out_c", "mdot_kg_per_s"]);
});

await scenario("hide panel: chart takes the full width, show panel restores it", async (p) => {
  await load(p, hourlySemicolon());
  await waitChart(p);
  const chartWidth = () => p.evaluate(() => document.getElementById("chart").clientWidth);
  const before = await chartWidth();
  await p.click("button[title='Hide panel']");
  await p.waitForSelector("#expand", { state: "visible" });
  await p.waitForFunction(() => window.__csvPlotChart.getWidth() > 1000);
  assert.ok((await chartWidth()) > before, "chart is wider once the panel is hidden");
  assert.ok((await chartWidth()) > 1100, "chart fills the 1200 px viewport");
  await p.screenshot({ path: join(shots, "panel-hidden-dark.png") });
  await p.click("#expand");
  await p.waitForSelector("#panel", { state: "visible" });
  assert.equal(await chartWidth(), before);
});

await scenario("histogram mode: column choice, statistics, bins, back to lines", async (p) => {
  await load(p, hourlySemicolon());
  await waitChart(p);
  await tick(p, "t_out_c");
  await p.click("button[data-mode=histogram]");
  await p.waitForSelector("#stats:not([hidden])");
  // Defaults to the first ticked column; X choice and axis tags are hidden.
  let o = await option(p);
  assert.equal(o.series[0].type, "custom");
  assert.equal(o.title[0].text, "q_demand_kw");
  assert.equal(await p.locator(".x-section").isHidden(), true);
  assert.equal(await p.locator(".y-list input[type=radio]:checked").count(), 1);
  const disabled = p.locator(".y-list li.disabled");
  assert.deepEqual(await disabled.locator(".tag").allTextContents(), ["time", "text"]);
  const stat = (key) => p.locator(`tr[data-stat=${key}] td`).textContent();
  assert.equal(await stat("count"), "8760");
  assert.equal(await stat("missing"), "0");
  const total = o.series[0].data.reduce((sum, bar) => sum + bar[2], 0);
  assert.equal(total, 8760);
  assert.deepEqual(
    o.series[0].markLine.data.map((d) => d.name),
    ["mean", "median"],
  );

  // Pick another column, then a bin count.
  await p.locator(".y-list li", { hasText: "t_out_c" }).locator("input[type=radio]").check();
  await p.waitForFunction(() => window.__csvPlotChart.getOption().title[0].text === "t_out_c");
  await p.locator("#bins-select").selectOption("20");
  await p.waitForFunction(() => {
    const n = window.__csvPlotChart.getOption().series[0].data.length;
    return n >= 15 && n <= 25;
  });
  assert.equal(await p.locator("#bins-select").inputValue(), "20");
  await p.screenshot({ path: join(shots, "histogram-dark.png") });
  await p.waitForFunction(() =>
    window.__sent.some((m) => m.state?.histogram?.column === "t_out_c" && m.state.histogram.bins),
  );
  const saved = await p.evaluate(() => window.__sent.filter((m) => m.type === "saveState").at(-1));
  assert.deepEqual(saved.state.histogram, { column: "t_out_c", bins: 20 });
  assert.equal(saved.state.mode, "histogram");
  const status = await p.evaluate(() => window.__sent.filter((m) => m.type === "status").at(-1));
  assert.deepEqual(status.status.series, ["t_out_c"]);
  assert.equal(status.status.mode, "histogram");

  // Back to lines: the ticked columns are unchanged.
  await p.click("button[data-mode=lines]");
  await p.waitForFunction(() => window.__csvPlotChart.getOption().series[0].type === "line");
  o = await option(p);
  assert.deepEqual(
    o.series.map((s) => s.name),
    ["q_demand_kw", "t_out_c"],
  );
  assert.equal(await p.locator("#stats").isHidden(), true);
  assert.equal(await p.locator(".x-section").isHidden(), false);
});

await scenario(
  "histogram in light theme, from a saved state",
  async (p) => {
    await load(p, hourlySemicolon(), { mode: "histogram", histogram: { column: "q_boiler_kw" } });
    await waitChart(p);
    assert.equal((await option(p)).title[0].text, "q_boiler_kw");
    await p.screenshot({ path: join(shots, "histogram-light.png") });
  },
  "light",
);

await scenario("histogram zoom re-bins the zoomed range", async (p) => {
  await load(p, hourlySemicolon(), {
    mode: "histogram",
    histogram: { column: "t_out_c", bins: 20 },
  });
  await waitChart(p);
  const bins = () =>
    p.evaluate(() => {
      const data = window.__csvPlotChart.getOption().series[0].data;
      return {
        n: data.length,
        width: data[0][1] - data[0][0],
        from: data[0][0],
        to: data.at(-1)[1],
      };
    });
  const full = await bins();
  assert.equal(await p.locator(".zoom-note").isHidden(), true);

  // Mouse wheel over the plot: the bins cover the narrower range, about as many of them.
  const box = await p.locator("#chart").boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) await p.mouse.wheel(0, -200);
  await p.waitForSelector(".zoom-note:not([hidden])");
  let zoomed = await bins();
  assert.ok(zoomed.to - zoomed.from < full.to - full.from, "bins cover the zoomed range only");
  assert.ok(zoomed.width <= full.width, `width ${zoomed.width} <= ${full.width}`);
  assert.ok(zoomed.n >= 10, `${zoomed.n} bins`);

  // Area zoom from the toolbox (same action): the note reports the values inside. The note
  // already shows the wheel zoom, and re-binning waits for the next animation frame: wait for
  // the note to change, not just for it to match.
  const wheelNote = await p.locator(".zoom-note").textContent();
  await p.evaluate(() =>
    window.__csvPlotChart.dispatchAction({ type: "dataZoom", start: 40, end: 60 }),
  );
  await p.waitForFunction((before) => {
    const text = document.querySelector(".zoom-note").textContent;
    return text !== before && /^Zoomed on .* values \(/.test(text);
  }, wheelNote);
  zoomed = await bins();
  const span = full.to - full.from;
  assert.ok(zoomed.from <= full.from + 0.4 * span + zoomed.width, "first bin at the window");
  assert.ok(zoomed.to >= full.from + 0.6 * span - zoomed.width, "last bin at the window");
  assert.ok(zoomed.width < full.width);
  await p.screenshot({ path: join(shots, "histogram-zoom-dark.png") });

  // Changing the bin count keeps the zoomed range.
  await p.locator("#bins-select").selectOption("50");
  await p.waitForFunction(() => window.__csvPlotChart.getOption().series[0].data.length >= 40);
  assert.equal(await p.locator(".zoom-note").isHidden(), false);
  const kept = await bins();
  assert.ok(Math.abs(kept.from - zoomed.from) <= zoomed.width, "same range after a bins change");

  // Reset zoom: back to the bins of the whole column.
  await p.locator("#bins-select").selectOption("20");
  await p.evaluate(() => window.__csvPlotChart.dispatchAction({ type: "restore" }));
  await p.waitForSelector(".zoom-note", { state: "hidden" });
  assert.deepEqual(await bins(), full);
});

await scenario(
  "restores saved choices; lines screenshot in light theme",
  async (p) => {
    await load(p, hourlySemicolon(), {
      x: "timestamp",
      ys: ["q_demand_kw", "q_boiler_kw", "t_out_c", "storage_kw"],
      mode: "lines",
    });
    await waitChart(p);
    const o = await option(p);
    assert.deepEqual(
      o.series.map((s) => s.name),
      ["q_demand_kw", "q_boiler_kw", "t_out_c", "storage_kw"],
    );
    await p.mouse.move(760, 360);
    await p.waitForSelector("text=/2020-\\d\\d-\\d\\d \\d\\d:00/");
    await p.screenshot({ path: join(shots, "lines-light.png") });
  },
  "light",
);

await scenario("row number as X, unit-less columns grouped by magnitude, filter", async (p) => {
  await load(p, plainComma());
  await waitChart(p);
  assert.equal(await p.locator("#x-select").inputValue(), "__row__");
  await tick(p, "beta");
  await tick(p, "gamma");
  const o = await option(p);
  assert.equal(o.xAxis[0].type, "value");
  assert.equal(o.dataset[0].source.x[0], 1);
  assert.deepEqual(
    o.series.map((s) => s.yAxisIndex),
    [0, 1, 0],
  );
  await p.fill("input.filter", "gam");
  assert.equal(await p.locator(".y-list li:not([hidden])").count(), 1);
});

await scenario("manual separator and decimal override re-parse the file", async (p) => {
  await load(p, "a;b\n1,5;2,5\n3,5;4,5\n");
  await waitChart(p);
  await p.locator(".settings select").nth(1).selectOption(".");
  // With "." as decimal mark the values become text: nothing left to plot.
  await p.waitForFunction(() =>
    document.getElementById("overlay").textContent.includes("Tick one or more"),
  );
  await p.locator(".settings select").nth(1).selectOption("");
  await waitChart(p);
  const o = await option(p);
  assert.equal(o.dataset[0].source.s0[0], 1.5);
});

await scenario("live update keeps the selection", async (p) => {
  await load(p, hourlySemicolon(48), { ys: ["q_demand_kw", "t_out_c"] });
  await waitChart(p);
  await p.evaluate(() =>
    window.postMessage(
      {
        type: "update",
        text: "timestamp;q_demand_kw;t_out_c\n2020-01-01 00:00;1;2\n2020-01-01 01:00;3;4\n",
      },
      "*",
    ),
  );
  await p.waitForFunction(() => window.__csvPlotChart.getOption().dataset[0].source.x.length === 2);
  const o = await option(p);
  assert.deepEqual(
    o.series.map((s) => s.name),
    ["q_demand_kw", "t_out_c"],
  );
});

await scenario("too-large file asks before plotting", async (p) => {
  await p.evaluate(() => window.postMessage({ type: "tooLarge", sizeMb: 120 }, "*"));
  await p.click("#overlay button");
  assert.equal(await p.evaluate(() => window.__sent.at(-1).type), "forceLoad");
});

await scenario("1,000,000 rows × 20 columns", async (p) => {
  const text = large();
  const start = Date.now();
  await load(p, text, { ys: ["s0_kw", "s5_kw", "s19_kw"] });
  await p.waitForFunction(
    () => window.__csvPlotChart && document.getElementById("overlay").hidden,
    null,
    { timeout: 60_000 },
  );
  const elapsed = (Date.now() - start) / 1000;
  console.log(`    (parsed and drawn in ${elapsed.toFixed(1)} s)`);
  assert.ok(elapsed < 15, `took ${elapsed} s`);
  await p.screenshot({ path: join(shots, "large.png") });
});

await scenario("Excel workbook: active sheet, formula results, sheet switch", async (p) => {
  await loadWorkbook(p, hourlyWorkbook());
  await waitChart(p);
  // The sheet list replaces separator and decimal; chart sheets are left out.
  assert.equal(await p.locator("#sheet-select").inputValue(), "Hourly");
  assert.deepEqual(await p.locator("#sheet-select option").allTextContents(), [
    "Readme",
    "Hourly",
    "Daily",
    "Lookup  (hidden)",
  ]);
  assert.equal(await p.locator(".settings select").count(), 1);
  assert.equal(await p.locator("#x-select").inputValue(), "timestamp");
  await tick(p, "q_boiler_kw");
  let o = await option(p);
  assert.equal(o.xAxis[0].type, "time");
  assert.equal(o.dataset[0].source.x.length, 8760);
  assert.equal(o.dataset[0].source.x[0], Date.UTC(2020, 0, 1));
  const boiler = o.series.findIndex((s) => s.name === "q_boiler_kw");
  assert.equal(o.dataset[0].source[`s${boiler}`][0], 110);
  assert.equal(o.toolbox[0].feature.saveAsImage.name, "plant - Hourly");
  await p.screenshot({ path: join(shots, "excel-dark.png") });

  await p.locator("#sheet-select").selectOption("Daily");
  await p.waitForFunction(
    () => window.__csvPlotChart.getOption().dataset[0].source.x.length === 366,
  );
  o = await option(p);
  assert.deepEqual(
    o.series.map((s) => s.name),
    ["energy_kwh"],
  );
  await p.waitForFunction(() => window.__sent.some((m) => m.state?.sheet === "Daily"));
  const saved = await p.evaluate(() => window.__sent.filter((m) => m.type === "saveState").at(-1));
  assert.equal(saved.state.sheet, "Daily");
  assert.deepEqual(saved.state.sheets.Hourly.ys, ["q_demand_kw", "q_boiler_kw"]);

  // Back to the first sheet: its choices are restored.
  await p.locator("#sheet-select").selectOption("Hourly");
  await p.waitForFunction(() => window.__csvPlotChart.getOption().series.length === 2);
});

await scenario("Excel workbook: remembered sheet and choices, reload on change", async (p) => {
  await loadWorkbook(p, hourlyWorkbook(24), {
    sheet: "Daily",
    sheets: { Daily: { x: "day", ys: ["peak_kw"] } },
  });
  await waitChart(p);
  assert.equal(await p.locator("#sheet-select").inputValue(), "Daily");
  assert.deepEqual(
    (await option(p)).series.map((s) => s.name),
    ["peak_kw"],
  );
  const changed = makeXlsx({
    sheets: [
      {
        name: "Daily",
        rows: [
          ["day", "peak_kw"],
          [1, 5],
          [2, 6],
          [3, 7],
        ],
      },
    ],
  });
  await loadWorkbook(p, changed, undefined, "updateWorkbook");
  await p.waitForFunction(() => window.__csvPlotChart.getOption().dataset[0].source.x.length === 3);
  assert.equal(await p.locator("#sheet-select").isDisabled(), true);
});

await scenario("legacy .xls workbook: same sheets and chart as the .xlsx", async (p) => {
  await loadWorkbook(p, hourlyXls());
  await waitChart(p);
  assert.equal(await p.locator("#sheet-select").inputValue(), "Hourly");
  assert.equal(await p.locator("#sheet-select option").count(), 4);
  await tick(p, "q_boiler_kw");
  const o = await option(p);
  assert.equal(o.xAxis[0].type, "time");
  assert.equal(o.dataset[0].source.x.length, 8760);
  assert.equal(o.dataset[0].source.x[8759], Date.UTC(2020, 11, 30, 23));
  const boiler = o.series.findIndex((s) => s.name === "q_boiler_kw");
  assert.equal(o.dataset[0].source[`s${boiler}`][0], 110);
  await p.locator("#sheet-select").selectOption("Daily");
  await p.waitForFunction(
    () => window.__csvPlotChart.getOption().dataset[0].source.x.length === 366,
  );
});

await scenario("Excel workbook posted as a JSON Buffer is still read", async (p) => {
  const bytes = Array.from(hourlyWorkbook(24));
  await p.evaluate(
    (data) =>
      window.postMessage(
        { type: "loadWorkbook", data: { type: "Buffer", data }, fileName: "b.xlsx", state: {} },
        "*",
      ),
    bytes,
  );
  await waitChart(p);
  assert.equal(await p.locator("#sheet-select").inputValue(), "Hourly");
});

await scenario("Excel workbook: notices and errors", async (p) => {
  await loadWorkbook(
    p,
    makeXlsx({
      sheets: [
        {
          name: "S",
          rows: [
            ["a", "b"],
            [1, { f: "A2*2" }],
            [2, { f: "A3*2" }],
          ],
        },
      ],
    }),
  );
  await waitChart(p);
  assert.match(await p.locator(".notice").first().textContent(), /2 formula cells have no saved/);
  await loadWorkbook(p, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]));
  await p.waitForFunction(() => document.getElementById("overlay").textContent.includes(".xls"));
});

await browser.close();
console.log(failures ? `${failures} browser test(s) failed` : "all browser tests passed");
process.exit(failures ? 1 : 0);
