import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { menuPatch } from "../../src/webview/menu";
import { columnStats } from "../../src/webview/stats";
import { statsText } from "../../src/webview/statsCard";

describe("right-click menu", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const menu: { command: string; when: string }[] = pkg.contributes.menus["webview/context"];

  it("matches the graph views by webviewId (webview == … never matches)", () => {
    expect(menu.length).toBeGreaterThan(0);
    for (const item of menu) expect(item.when).toMatch(/^webviewId (==|=~) /);
  });
  it("hides the menu commands from the command palette", () => {
    const hidden = pkg.contributes.menus.commandPalette
      .filter((c: { when: string }) => c.when === "false")
      .map((c: { command: string }) => c.command);
    for (const item of menu) expect(hidden).toContain(item.command);
  });
  it("turns menu items into choices", () => {
    const state = { mode: "histogram" as const, ys: ["a", "b"], axisOverrides: { a: 2 } };
    expect(menuPatch("stacked", undefined, state)).toEqual({ mode: "stacked" });
    expect(menuPatch("hidePanel", undefined, state)).toEqual({ panelCollapsed: true });
    // A column picked from the histogram goes back to the line chart.
    expect(menuPatch("plotOnly", "b", state)).toEqual({
      ys: ["b"],
      axisOverrides: {},
      mode: "lines",
    });
    expect(menuPatch("plotOnly", "b", { mode: "stacked" })?.mode).toBe("stacked");
    expect(menuPatch("useAsX", "a", state)).toEqual({ x: "a", ys: ["b"], mode: "lines" });
    expect(menuPatch("histogramOf", "a", { histogram: { bins: 20 } })).toEqual({
      mode: "histogram",
      histogram: { bins: 20, column: "a" },
    });
    expect(menuPatch("plotOnly", undefined, state)).toBeUndefined();
    expect(menuPatch("resetZoom", undefined, state)).toBeUndefined();
  });
  it("copies the statistics as tab-separated lines", () => {
    const text = statsText("load_kw", columnStats(Float64Array.from([1, 2, 3, NaN])));
    const rows = text.split("\n").map((r) => r.split("\t"));
    expect(rows[0]).toEqual(["Column", "load_kw"]);
    expect(rows).toContainEqual(["Count", "3"]);
    expect(rows).toContainEqual(["Missing", "1"]);
    expect(rows).toContainEqual(["Mean", "2"]);
  });
});
