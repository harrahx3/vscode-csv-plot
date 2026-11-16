# CSV & Excel Plot

Plot the columns of a CSV file or of an Excel sheet as interactive charts, without leaving VS
Code.

- **One click between raw and graph.** A chart icon in the editor title bar of any `.csv` / `.tsv`
  file switches the tab to the graph view; a matching icon switches back to the raw text. The
  plain text editor stays the default, so Rainbow CSV (or any other CSV extension) keeps working.
- **Excel workbooks** (`.xlsx`, `.xlsm`, and legacy `.xls`) open directly in the graph view, one table per sheet,
  with a sheet selector — see [Excel workbooks](#excel-workbooks).
- **X axis**: any column — timestamps get a real time axis — or _(row number)_.
- **Y axis**: tick as many columns as you like.
- **Automatic multiple Y axes** (up to 4), overridable per column — see below.
- **Lines or stacked areas** (stacking only adds up columns that share an axis).
- **Separator and decimal mark** detected automatically (`,` `;` tab `|`, and `.` or `,`), with a
  manual override when the guess is wrong.
- Zoom (mouse wheel, drag, slider), hover tooltip with every plotted value, legend to hide
  series, save as PNG. Follows the VS Code colour theme.
- Large files: comfortable at one year of hourly data (8,760 rows × 20 columns), still usable at
  1,000,000 rows (points are thinned for display while keeping peaks; zooming shows full detail).
- Remembers your choices per file. Edits to the file redraw the chart, keeping your choices.

## Install

From the Visual Studio Marketplace: search for **CSV & Excel Plot** in the Extensions view, or run

```bash
code --install-extension harrahx3.vscode-csv-plot
```

Each release's `.vsix` is also attached to the [GitHub Releases](https://github.com/harrahx3/vscode-csv-plot/releases)
(_Extensions view → … → Install from VSIX…_). Works in VS Code connected to WSL too.

## Use

Open a CSV file and click the chart icon (**Open as Graph**) in the editor title bar — or run
**CSV Plot: Open as Graph** from the command palette, or **Reopen Editor With… → CSV Plot**.

In the left panel:

| Control                     | What it does                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Separator / Decimal         | _Auto_ shows what was detected; pick another value to re-read the file. A notice appears when the detection is unsure. |
| Lines / Stacked / Histogram | Display mode (see _Histogram and statistics_ below).                                                                   |
| X axis                      | A column, or _(row number)_. Defaults to the first timestamp column.                                                   |
| Y series                    | Tick columns to plot; filter box for long lists; _clear_ unticks all. Text columns are greyed out.                     |
| `Y1 (auto)` tag             | Axis of a ticked column: keep _auto_, move it to another axis, or to a _New axis_.                                     |

Click the file icon (**Show Raw CSV**) to go back to the text.

### Histogram and statistics

Click **Histogram** to see the distribution of one column. The column list becomes a single
choice among the number columns (it starts on the first ticked column). The chart shows the
histogram with the mean (solid line) and the median (dashed line). The card on the right lists:
count, missing cells, mean, median, sample standard deviation, minimum, 25th and 75th
percentiles (linear interpolation, as Excel `PERCENTILE.INC`), maximum and sum.

**Bins** is automatic by default (Freedman–Diaconis rule, at most 200 bins); pick _about 10 /
20 / 50 / 100_ to change it. Bin edges are rounded to readable values, and whole-number data
gets one bin per value or group of values. Hover a bar for its range, count and share. Click
**Lines** or **Stacked** to go back: the ticked columns are unchanged. The column and the bins
are remembered per file (per sheet for a workbook).

**Zoom** into part of the distribution with the mouse wheel, the slider under the chart or the
_Zoom to area_ tool (drag over the range). The zoomed range is re-binned: the bars get narrower
and show the detail of that range, and the count axis rescales to it. The card notes the range
and how many values it holds; the statistics still cover the whole column. Changing the bins
keeps the zoom; _Reset zoom_ goes back to the whole column.

### Excel workbooks

Opening an `.xlsx`, `.xlsm` or `.xls` file shows it in the graph view right away (or use **Reopen Editor
With… → CSV Plot (Excel graph view)** if another Excel extension opened it).

- **Sheet**: the panel shows a sheet list instead of Separator / Decimal. The first time, the
  sheet that was active when the file was last saved in Excel is shown. Hidden sheets are listed
  with _(hidden)_; chart sheets are left out. Your choices (X, Y series, axes, mode) are
  remembered per sheet.
- **One table per sheet**: the table may start anywhere (not only in `A1`); a title or a note
  above it (a row with a single filled cell) is skipped, as are empty columns. The first row is
  the header unless it holds only numbers or dates.
- **Formulas** show the result Excel saved with the file — nothing is recalculated. A file
  written by a tool that does not calculate (for instance Python's openpyxl) has no saved results:
  a notice then asks you to open and save it once in Excel.
- **Dates** are recognised from the cell's number format (and from dates typed as text), shown
  as written, without time-zone conversion. Durations such as `[h]:mm` stay numbers.
- Errors such as `#N/A` or `#DIV/0!` are gaps in the line; `TRUE`/`FALSE` plot as 1/0.
- **Reload**: the view follows changes to the file on disk (saving from Excel). Files on a
  Windows drive opened from WSL may not report changes: click the refresh icon (**Reload
  Workbook**) in the editor title bar.
- Legacy `.xls` files (Excel 97–2003) work the same way. Not supported: binary `.xlsb`, Excel
  5.0/95 files and password-protected workbooks — save them as `.xlsx` first.

### How columns are grouped onto Y axes

1. **Unit from the column name**:
   - text in trailing brackets: `Power [kW]` → `kW`, `Temp (°C)` → `°C`;
   - otherwise the part after the **last underscore**, whatever it is: `heat_kw` → `kw`,
     `t_out_degc` → `degc`; compound units with `_per_` are kept whole: `mdot_kg_per_s` →
     `kg_per_s`; a purely numeric suffix (`sensor_2`) is not a unit. Case is ignored.
2. Columns with the same unit share an axis, labelled with the unit.
3. Columns without a unit share an axis when their largest values are within a factor 10;
   otherwise they get their own.
4. At most 4 axes; beyond that, a column joins the axis of closest magnitude.
5. Your manual choice (the axis tag) always wins.

### Timestamps

Recognised: ISO 8601 (`2020-01-01`, `2020-01-01T00:00`, `2020-01-01 00:00:00.5`, optional `Z` or
`±hh:mm`) and `dd/mm/yyyy hh:mm[:ss]`, `dd.mm.yyyy …` (month-first when the data proves it).
Timestamps **without** an offset are shown exactly as written — no time-zone conversion, so no
daylight-saving gaps or duplicates in hourly data. Timestamps with an offset are shown in UTC.

## Settings

| Setting                  | Default |                                                                  |
| ------------------------ | ------- | ---------------------------------------------------------------- |
| `csvPlot.confirmAboveMB` | 50      | Ask before plotting a file larger than this (MB); 0 = never ask. |

## Develop

```bash
npm ci
npm run watch            # rebuild on change; press F5 in VS Code to start a test instance
npm run lint && npm run typecheck
npm test                 # unit tests (parsing, detection, axis grouping, chart options)
npm run package          # -> vscode-csv-plot-<version>.vsix
npm run test:browser     # the real webview in headless Chromium (Playwright's browser cache,
                         # or: npm run test:browser -- --chromium=<path-to-chrome>)
npm run test:vscode      # integration tests in a downloaded VS Code (needs a display:
                         # WSLg, or xvfb-run on a headless Linux)
```

Layout: `src/extension/` runs in the VS Code extension host (custom editor registration for
CSV text and for Excel files, commands, per-file state); `src/webview/` runs in the graph view
(CSV parsing, Excel reading in `parse/readWorkbook.ts` — `xlsx.ts` with `fflate` for the zip
archive, `xls.ts` and `cfb.ts` for legacy files — axis grouping,
ECharts option, side panel). Parsing happens in the webview so a big file never blocks the
extension host. Design notes: `docs/superpowers/specs/`.

Release: bump `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version`), add a
`CHANGELOG.md` entry, commit, then push a tag `vX.Y.Z`. The _Publish_ workflow
(`.github/workflows/publish.yml`) runs the tests, builds the `.vsix`, attaches it to a GitHub
Release and publishes it to the Visual Studio Marketplace (Trusted Publishing, no stored token).

## License

[MIT](LICENSE). The bundled third-party libraries keep their own licenses, listed in
[ThirdPartyNotices.txt](ThirdPartyNotices.txt).
