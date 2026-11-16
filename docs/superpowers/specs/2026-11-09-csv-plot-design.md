# CSV Plot — VS Code extension — design

Date: 2026-11-09 · Status: implemented (v0.1.0)

## 1. Intent

A VS Code extension that turns any open CSV file into an interactive chart, without leaving the
editor. The owner works daily with time-series CSVs (typically 8,760 hourly rows × ~20 numeric
columns — one year of hourly simulation output) and wants to look at them quickly: pick an X
column, tick a few Y columns, see the curves. It must be generic — not tied to any one project's
file layout or column naming.

Success: open a CSV, click one icon, see a correct chart of the columns you tick within a second
or two; click again, be back in the raw text with Rainbow CSV colouring intact.

## 2. Goals

- **G1 — Graph view of a CSV** next to/instead of the raw text, in the same editor tab.
- **G2 — Easy switching** between raw CSV view and graph view (one click each way).
- **G3 — X axis choice**: any column, with real date/time handling for timestamp columns, or
  **"(row number)"** (no X column: the line index is the X).
- **G4 — Multiple Y series** on the same chart.
- **G5 — Multiple Y axes**, assigned **automatically** and overridable by the user (rule in §5.4).
- **G6 — Lines or stacked areas** display mode.
- **G7 — Separator and decimal mark** detected automatically, with a manual override when the
  guess fails or is wrong.
- **G8 — Scales beyond the typical case**: comfortable at 8,760 × 20, still usable up to about
  1,000,000 rows × 20 columns.
- **G9 — Shareable**: published on GitHub and the Visual Studio Marketplace, also installable from a `.vsix`.

## 3. Non-goals

- Editing data from the graph view (the raw view remains the place to edit).
- Plotting several files on one chart, joins, pivots, statistics, formulas on columns.
- Chart types other than lines and stacked areas (no bar, scatter, heatmap) in this version.
- Publishing on the public VS Code Marketplace.
- Any knowledge specific to pandaprosumer / SenergyNets.

## 4. Anti-goals (would be a failure even if it "works")

- **Breaking Rainbow CSV or replacing the default CSV editor.** The plain text editor must stay
  the default for `.csv`; the graph view is opt-in.
- **Freezing VS Code** while loading a big file (the extension host must never be blocked by
  parsing; see §6.3).
- **A hard-coded list of units** for axis grouping (`kw`, `c`, …). The rule must work on any
  naming scheme that follows the underscore-suffix convention.
- Wrong time axis: shifting or duplicating hours (e.g. daylight-saving artefacts on hourly data).

## 5. Behaviour

### 5.1 Opening and switching (decided by the owner: "easy to switch", Rainbow CSV keeps working)

- The extension registers a **custom text editor** for `*.csv` and `*.tsv` with priority
  **`option`** — never the default. Raw CSV stays the normal text editor, so Rainbow CSV (or any
  other CSV extension) keeps working there unchanged.
- **Raw → graph**: a chart icon in the editor title bar of CSV/TSV files ("Open as Graph") reopens
  the same tab in the graph view. Also available from the command palette and from VS Code's
  "Reopen Editor With…".
- **Graph → raw**: a matching icon in the graph view's title bar ("Show Raw CSV") reopens the tab
  with the default text editor.
- _Builder's call / my call_: implement the toggle with `vscode.openWith` (target view type, or
  `"default"` for raw) on the active tab's URI so it replaces the tab rather than opening a second
  one.
- _My call_: the graph view follows the underlying text document. When the file is changed and
  saved (or changed on disk), the graph re-parses and redraws, **keeping the current axis
  selections** for columns that still exist.

### 5.2 Layout (decided by the owner: layout A — side panel + chart)

```
┌──────────────────────┬──────────────────────────────────────────────┐
│ Separator  [ ; ▾ ]   │                                              │
│ Decimal    [ , ▾ ]   │                                              │
│ Mode [Lines|Stacked] │                                              │
│──────────────────────│                 chart                        │
│ X axis               │   (zoom, pan, hover tooltip with all         │
│ [ timestamp     ▾ ]  │    series values at that X, legend)          │
│──────────────────────│                                              │
│ Y series  [filter…]  │                                              │
│ ☑ q_demand_kw  [Y1]  │                                              │
│ ☑ p_el_kw      [Y1]  │                                              │
│ ☑ t_out_c      [Y2]  │                                              │
│ ☐ mdot_kg_per_s      │                                              │
│ ☐ label (text)  grey │                                              │
└──────────────────────┴──────────────────────────────────────────────┘
```

- Left panel: parse settings (separator, decimal mark), display mode, X dropdown, Y column list
  with checkboxes, a filter box to narrow the list (many columns), and per ticked column an
  **axis tag** (`Y1`, `Y2`, …) that can be clicked to move the column to another or a new axis.
- Non-numeric columns appear in the Y list greyed out / disabled (they can still be X).
- _My call_: the panel is resizable or collapsible so the chart can take the full width.
- _My call_: the view follows the VS Code colour theme (light/dark) using the webview's theme CSS
  variables for background, text, grid lines.

### 5.3 X axis (decided by the owner: timestamps supported; "no X" = row number)

- X dropdown entries: **"(row number)"** first, then every column.
- **Default selection** (my call): the first column detected as date/time; otherwise
  "(row number)".
- A column is **date/time** if (almost) all non-empty values parse as one of:
  ISO 8601 (`2020-01-01`, `2020-01-01T00:00`, `2020-01-01 00:00:00`, with optional `Z` or
  `±hh:mm` offset), and the common European forms `dd/mm/yyyy hh:mm[:ss]` and
  `dd.mm.yyyy hh:mm[:ss]`. _My call_: `dd/mm` vs `mm/dd` is resolved by looking for a value whose
  first part is > 12; if ambiguous, assume `dd/mm` (European data).
- **Time zones (my call)**: timestamps **without** an offset are shown exactly as written — no
  conversion to the local time zone (internally treated as UTC). This avoids daylight-saving
  gaps/duplicates on hourly data. Timestamps with an offset are converted to UTC and the axis
  says "UTC".
- A numeric X column gives a numeric (value) X axis; a text column gives a category axis.
- _My call_: rows are plotted in file order; if a time/numeric X is not sorted, it is still
  plotted in file order (no silent re-sorting) and a small notice says the X column is not
  monotonic.

### 5.4 Y series and automatic Y axes (decided by the owner: auto-group by suffix, generic, overridable)

Grouping rule, applied to the ticked columns in order:

1. **Unit from the name.** The unit key of a column is, in order of precedence:
   a. text inside trailing brackets: `Power [kW]` → `kW`, `Temp (°C)` → `°C` _(my call)_;
   b. otherwise the part after the **last underscore**: `heat_kw` → `kw`, `t_out_degc` → `degc`.
   **No list of known units** — whatever the suffix is, columns with the same suffix share
   an axis. _My call_: a compound unit written with `_per_` is kept whole:
   `mdot_kg_per_s` → `kg_per_s` (not `s`).
   c. Comparison is case-insensitive.
2. Columns with the **same unit key** go on the same axis. The axis is labelled with that unit.
3. **No unit key** (no underscore, no brackets): fallback **by magnitude** _(my call)_: the column
   joins an existing unit-less axis whose data range (max absolute value) is within a factor of
   10 of its own; otherwise it gets a new axis.
4. **At most 4 axes** _(my call — more is unreadable)_. Once 4 exist, further columns go to the
   existing axis with the closest magnitude.
5. The user can **override** by clicking a column's axis tag: choose an existing axis or "new
   axis". Overrides stick for that column until it is unticked.

Axis placement: Y1 on the left, Y2 on the right, Y3/Y4 further right with an offset. Each axis
uses the colour of its first series or a neutral colour, and shows its unit label.

### 5.5 Display mode: lines or stacked areas (decided by the owner)

- Global switch **Lines | Stacked areas**.
- _My call_: stacking happens **per axis** only — columns on the same axis are stacked together;
  different axes are never summed. An axis with a single column shows a plain filled area.
- _My call_: within a stack, negative values stack downward from zero separately from positive
  ones (ECharts `stackStrategy` handles this), so e.g. storage charge/discharge reads correctly.

### 5.6 Chart interaction (my call — standard expectations)

- Mouse-wheel zoom and drag pan on X; a range slider under the chart; "reset zoom" button.
- Hover tooltip showing X and every visible series' value at that X.
- Clicking a legend entry hides/shows a series.
- Missing / unparsable cells are **gaps** in the line (not zeros).
- _My call_: "Save as PNG" button (ECharts toolbox) — cheap and useful.

### 5.7 Separator and decimal mark (decided by the owner: auto + manual choice)

- **Separator** candidates: `,` `;` tab `|`. Detection: the candidate that yields the most
  consistent column count > 1 over the first ~100 lines (respecting quoted fields).
- **Decimal mark** candidates: `.` and `,`. Detection: if the separator is `,` the decimal mark
  is `.`; otherwise look at numeric-looking fields — values like `12,5` → `,`. Thousands
  separators are not supported (my call).
- Both appear as dropdowns at the top of the panel showing the detected value. When detection is
  inconclusive, a short notice says so ("couldn't detect the separator — please check"). Changing
  a dropdown re-parses and redraws.
- _My call_: header row is assumed to be the first line. If the first line looks numeric
  (every field parses as a number), columns are named `col1`, `col2`, ….

### 5.8 Remembering choices (my call)

Per file (keyed by its URI, stored in the extension's `workspaceState`): separator and decimal
overrides, X column, ticked Y columns, axis overrides, display mode. Re-opening the graph view
restores them; columns that no longer exist are ignored.

## 6. How it is built

### 6.1 Stack (my call; the owner deferred to recommendations)

- **TypeScript**, Node 22 (already installed via nvm in WSL), **npm**.
- **ECharts 5** in the webview — time axis, multiple Y axes, stacked areas, `dataZoom`, LTTB
  `sampling`, theme-able. Same library the team's `vue-interface` uses.
- **Papa Parse** for CSV tokenising (quotes, embedded separators); own code for type detection,
  decimal-comma conversion and timestamp parsing.
- **esbuild** to bundle the extension and the webview script; **`@vscode/vsce`** to package
  the `.vsix`.
- **Vitest** for unit tests of the pure logic (separator/decimal detection, type and timestamp
  detection, unit-key extraction, axis grouping, stacking assembly).
- **ESLint + Prettier** (TypeScript defaults).
- Keep files short (< ~400 lines each); split parsing, detection, axis grouping, chart-option
  building, and webview UI into separate modules.

### 6.2 Architecture

- **Extension host side** (`src/extension/`): registers the `CustomTextEditorProvider`
  (view type e.g. `csvPlot.graph`, priority `option`), the two title-bar commands, state
  persistence, and forwards the document text to the webview on open and on change.
- **Webview side** (`src/webview/`): parsing, detection, UI panel, ECharts rendering.
  Communicates with the host by `postMessage` (`init`/`update` with text + saved state;
  `saveState` back).
- Webview security: strict Content-Security-Policy, scripts only from the extension's bundled
  files (no CDN), `localResourceRoots` limited to the extension's `dist/` folder.

### 6.3 Performance (owner: typical 8,760 × 20, "should be flexible")

- Targets: 8,760 × 20 shows a chart in **< 1 s** after clicking. 1,000,000 × 20 shows a chart in
  **a few seconds**, and VS Code stays responsive meanwhile.
- _My call_: parsing happens in the **webview** (ideally in a Web Worker), never in the extension
  host, so a big file can't freeze other extensions.
- Columns are stored as typed arrays (`Float64Array`) after parsing.
- ECharts `sampling: 'lttb'` + `large` mode on every series so only about one point per pixel is
  drawn while keeping peaks and dips; zooming in reveals full detail.
- Above a configurable size (default 50 MB, my call) show a confirmation before parsing.

### 6.4 Repository, hosting, distribution (decided: the recommendations)

- Local path: `~/Projects/tools/vscode-csv-plot` (WSL).
- Remote: GitHub, `https://github.com/harrahx3/vscode-csv-plot`.
- Default branch `main`. LF line endings.
- Install: `npm run package` produces `vscode-csv-plot-<version>.vsix`; install via
  "Extensions → … → Install from VSIX" (works in VS Code connected to WSL).
- **GitHub Actions**: on every push run lint + unit tests; on a tag `vX.Y.Z` build the `.vsix`,
  attach it to a GitHub Release and publish it to the Visual Studio Marketplace.
- README: what it does, screenshot, install from `.vsix`, usage, axis-grouping rule. No local
  paths, usernames or hostnames in committed files.
- Publisher id in `package.json`: `harrahx3` (Visual Studio Marketplace publisher).

## 7. Left to the builder

- Exact icons (codicons, e.g. `$(graph-line)` and `$(file-code)`/`$(table)`).
- Panel styling details, colour palette for series (should be readable in light and dark themes).
- Exact message protocol between host and webview.
- Whether parsing uses a dedicated Web Worker from day one or only above a size threshold.
- Test fixtures (small CSVs covering: comma/semicolon/tab, decimal comma, ISO and European
  timestamps, offsets, missing values, text columns, no header, quoted fields).

## 8. Acceptance checks

1. Open a `;`-separated, decimal-comma, 8,760-row hourly CSV → raw view shows Rainbow CSV
   colours; click graph icon → chart with the timestamp as X; separator `;` and decimal `,`
   detected.
2. Tick a `_kw` column, another `_kw` column and a `_c` column → two axes (kW left, c right).
3. Switch to Stacked areas → the two kW columns stack; the `_c` column is not added to them.
4. Pick "(row number)" as X → X shows 1…8760.
5. Click the raw icon → back to the text editor in the same tab, Rainbow CSV still active.
6. Edit a value in raw view, save, go back to graph → updated value, same selections.
7. A 1,000,000-row file opens without freezing VS Code; zoom shows full detail.
8. Unit tests pass; CI builds a `.vsix` on a tag.

## 9. Implementation notes (v0.1.0) — where the build differs from the above

- **No Papa Parse**: a small own tokenizer (`src/webview/parse/tokenize.ts`) fills typed columns
  directly, avoiding an array-of-strings copy of the whole file (memory at 1 M rows).
- **No Web Worker**: parsing runs in the webview's main thread, which is a separate process from
  the extension host, so VS Code stays responsive. 1,000,000 × 20 opens in about 6–8 s in
  headless Chromium (8,760 × 20: well under 1 s).
- **Per-file memory** uses `globalState` (most recent 200 files), not `workspaceState`, so the
  choices follow a file opened from any window.
- **Tooltip** is built from the full-resolution columns: with LTTB thinning, ECharts' axis
  tooltip only reports the series whose drawn point is nearest the cursor.
- **Saved choices survive re-parsing**: a ticked column that becomes text after a wrong
  separator/decimal pick is skipped when drawing but kept, so switching back restores it.
- **Colours**: a fixed 8-hue palette validated for colour-vision deficiencies (light and dark
  steps); a column's colour depends on its position in the file, so ticking others never
  repaints it; from the 9th column on, lines are dashed then dotted.
- **Tests**: unit (Vitest), real webview in headless Chromium with the production CSP
  (`test/browser/run.mjs`), and VS Code integration tests with Rainbow CSV installed
  (`test/vscode/`).
