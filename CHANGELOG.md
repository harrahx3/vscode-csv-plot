# Changelog

## 1.1.0 — 2026-11-23

- **Right-click menu** in the graph view, instead of the default Cut / Copy / Paste:
  - on the chart: switch between Lines, Stacked and Histogram, reset the zoom, hide or show the
    panel, **save the chart as PNG** (with a save dialog, next to the file by default), show the
    raw CSV or reload the workbook;
  - on a column of the panel: plot only this column, show its histogram, use it as the X axis,
    copy its name;
  - on the statistics card: **copy the statistics** as tab-separated lines for a spreadsheet.
- Text fields keep the Cut / Copy / Paste menu.

## 1.0.1 — 2026-11-16

- The changelog of 1.0.0 now lists every change of that release; the first 1.0.0 package
  left several out. No change to the extension itself.

## 1.0.0 — 2026-11-16

- Published on GitHub and the Visual Studio Marketplace under the MIT license, as
  _CSV & Excel Plot_. The extension ID is now `harrahx3.vscode-csv-plot`:
  uninstall a build installed earlier from a `.vsix` with another ID, or both run side by side.
- The command palette category, the settings section and the graph view are now called
  _CSV & Excel Plot_ too. Settings (`csvPlot.*`) and command IDs are unchanged.
- **Histogram zoom**: the same zoom tools as the line chart (mouse wheel, slider, toolbox _Zoom
  to area_ / _Reset zoom_). Zooming re-bins the visible range, so the bars get narrower and show
  the detail of that part of the distribution; the count axis follows. The statistics card notes
  the zoomed range and how many values it holds, while the statistics still describe the whole
  column. Changing the bin count keeps the zoomed range.
- Fixed: hiding the side panel made the chart disappear. The chart now fills the width with the
  panel hidden and comes back to its size when the panel is shown again.

## 0.3.0 — 2026-11-09

- **Histogram** display mode: the distribution of one number column, with mean and median
  lines, and a statistics card (count, missing, mean, median, standard deviation, minimum,
  25th/75th percentiles, maximum, sum). Automatic or chosen bin count; remembered per file.
- Legacy Excel 97–2003 workbooks (`.xls`) open in the graph view like `.xlsx` files: sheet
  selector, formula results, dates. Excel 5.0/95 and password-protected files get a clear
  message.
- Fix: Excel files showed "This file is not an Excel workbook" inside VS Code (0.2.0 bug).

## 0.2.0 — 2026-11-09

- Excel workbooks (`.xlsx`, `.xlsm`) open in the graph view: one table per sheet, sheet
  selector (starts on the sheet active in Excel), formula results as saved by Excel, dates from
  the number format, title rows above the table skipped, choices remembered per sheet.
- The Excel view reloads when the file changes on disk; a **Reload Workbook** button forces it.

## 0.1.0 — 2026-11-09

First version: graph view for CSV/TSV files (toggle with the raw view), X column or row number,
timestamp axis, multiple Y columns, automatic Y axes by unit suffix with manual override, lines
or stacked areas, separator and decimal-mark detection with manual override, zoom, tooltip,
save as PNG, per-file memory of choices.
