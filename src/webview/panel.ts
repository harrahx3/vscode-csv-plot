/** Left side panel: parse settings (or the sheet of a workbook), display mode, X choice, Y column list with axis tags. */
import type { DisplayMode } from "../shared/messages";
import type { AxisAssignment } from "./axes";
import { seriesStyle } from "./chartOptions";
import { DECIMALS, SEPARATORS } from "./parse/detect";
import type { Column, Table } from "./parse/table";
import { KEEP_DEFAULT_MENU, setMenuContext } from "./menu";

export const ROW_NUMBER = "__row__";
const AUTO = "";

export interface SheetChoice {
  names: string[];
  hidden: string[];
  active: string;
}

export interface PanelModel {
  table: Table;
  /** Excel workbooks: the sheet list replaces the separator and decimal settings. */
  sheets?: SheetChoice;
  separatorOverride?: string;
  decimalOverride?: string;
  mode: DisplayMode;
  x: string | null;
  ys: string[];
  axisOverrides: Record<string, number>;
  assignment: AxisAssignment;
  /** Histogram mode: the column shown. */
  histColumn: string | null;
  notices: string[];
  dark: boolean;
}

export interface PanelEvents {
  sheet(name: string): void;
  separator(value: string | undefined): void;
  decimal(value: string | undefined): void;
  mode(value: DisplayMode): void;
  x(name: string | null): void;
  toggleY(name: string, checked: boolean): void;
  clearYs(): void;
  axis(name: string, axis: number | undefined): void;
  histColumn(name: string): void;
  collapse(collapsed: boolean): void;
}

const SEPARATOR_LABELS: Record<string, string> = {
  ",": ",  comma",
  ";": ";  semicolon",
  "\t": "Tab",
  "|": "|  pipe",
};
const MODE_LABELS: Record<DisplayMode, string> = {
  lines: "Lines",
  stacked: "Stacked",
  histogram: "Histogram",
};
const MODE_TITLES: Record<DisplayMode, string> = {
  lines: "Ticked columns as lines",
  stacked: "Ticked columns as stacked areas",
  histogram: "Distribution and statistics of one column",
};
const DECIMAL_LABELS: Record<string, string> = { ".": ".  dot", ",": ",  comma" };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function select(
  options: [value: string, label: string][],
  value: string,
  onChange: (value: string) => void,
  title = "",
): HTMLSelectElement {
  const s = el("select", { title });
  for (const [v, label] of options) s.append(el("option", { value: v, textContent: label }));
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

export class Panel {
  private readonly settings = el("section", { className: "settings" });
  private readonly notices = el("div", { className: "notices" });
  private readonly xSection = el("section", { className: "x-section" });
  private readonly filter = el("input", {
    type: "search",
    placeholder: "Filter columns…",
    className: "filter",
  });
  private readonly list = el("ul", { className: "y-list" });
  private readonly yCount = el("span", { className: "count" });
  private readonly yTitle = el("span", { textContent: "Y series " });
  private readonly clear = el("button", {
    className: "link",
    textContent: "clear",
    title: "Untick all columns",
  });

  constructor(
    root: HTMLElement,
    private readonly events: PanelEvents,
  ) {
    this.clear.addEventListener("click", () => events.clearYs());
    const collapse = el("button", { className: "icon", textContent: "⟨", title: "Hide panel" });
    collapse.addEventListener("click", () => events.collapse(true));
    this.filter.addEventListener("input", () => this.applyFilter());
    this.filter.dataset.vscodeContext = KEEP_DEFAULT_MENU;
    root.append(
      el("header", { className: "panel-header" }, [
        el("span", { textContent: "CSV & Excel Plot" }),
        collapse,
      ]),
      this.settings,
      this.notices,
      this.xSection,
      el("section", { className: "y-section" }, [
        el("div", { className: "section-title" }, [this.yTitle, this.yCount, this.clear]),
        this.filter,
        this.list,
      ]),
    );
  }

  render(model: PanelModel): void {
    this.renderSettings(model);
    this.notices.replaceChildren(
      ...model.notices.map((n) => el("div", { className: "notice", textContent: n })),
    );
    this.renderX(model);
    if (model.mode === "histogram") this.renderHistColumns(model);
    else this.renderYs(model);
    this.applyFilter();
  }

  private renderSettings(m: PanelModel): void {
    const sepAuto = `Auto (${SEPARATOR_LABELS[m.table.separator.value]?.trim() ?? m.table.separator.value})`;
    const decAuto = `Auto (${DECIMAL_LABELS[m.table.decimal.value]?.trim() ?? m.table.decimal.value})`;
    const sep = select(
      [[AUTO, sepAuto], ...SEPARATORS.map((s): [string, string] => [s, SEPARATOR_LABELS[s]])],
      m.separatorOverride ?? AUTO,
      (v) => this.events.separator(v || undefined),
      "Column separator",
    );
    const dec = select(
      [[AUTO, decAuto], ...DECIMALS.map((d): [string, string] => [d, DECIMAL_LABELS[d]])],
      m.decimalOverride ?? AUTO,
      (v) => this.events.decimal(v || undefined),
      "Decimal mark",
    );
    const modeButtons = (["lines", "stacked", "histogram"] as DisplayMode[]).map((mode) => {
      const b = el("button", {
        textContent: MODE_LABELS[mode],
        title: MODE_TITLES[mode],
        className: m.mode === mode ? "active" : "",
      });
      b.setAttribute("aria-pressed", String(m.mode === mode));
      b.dataset.mode = mode;
      b.addEventListener("click", () => this.events.mode(mode));
      return b;
    });
    const mode = el(
      "div",
      { className: "segmented", role: "group", title: "Display mode" },
      modeButtons,
    );
    if (m.sheets) {
      this.settings.replaceChildren(
        el("label", {}, [el("span", { textContent: "Sheet" }), this.sheetSelect(m.sheets)]),
        mode,
      );
      return;
    }
    this.settings.replaceChildren(
      el("label", {}, [el("span", { textContent: "Separator" }), sep]),
      el("label", {}, [el("span", { textContent: "Decimal" }), dec]),
      mode,
    );
  }

  private sheetSelect(sheets: SheetChoice): HTMLSelectElement {
    const options = sheets.names.map((n): [string, string] => [
      n,
      sheets.hidden.includes(n) ? `${n}  (hidden)` : n,
    ]);
    const s = select(options, sheets.active, (v) => this.events.sheet(v), "Sheet to plot");
    s.id = "sheet-select";
    s.disabled = sheets.names.length < 2;
    return s;
  }

  private renderX(m: PanelModel): void {
    const options: [string, string][] = [[ROW_NUMBER, "(row number)"]];
    for (const c of m.table.columns)
      options.push([c.name, c.kind === "text" ? `${c.name}  (text)` : c.name]);
    const s = select(
      options,
      m.x ?? ROW_NUMBER,
      (v) => this.events.x(v === ROW_NUMBER ? null : v),
      "X axis",
    );
    s.id = "x-select";
    this.xSection.hidden = m.mode === "histogram";
    this.xSection.replaceChildren(
      el("div", { className: "section-title", textContent: "X axis" }),
      s,
    );
  }

  /** Histogram mode: the column list becomes a single choice among the number columns. */
  private renderHistColumns(m: PanelModel): void {
    this.yTitle.textContent = "Column ";
    this.yCount.textContent = "";
    this.clear.hidden = true;
    const items = m.table.columns.map((col) => {
      const usable = col.kind === "number";
      const radio = el("input", {
        type: "radio",
        name: "hist-column",
        checked: col.name === m.histColumn,
        disabled: !usable,
      });
      radio.addEventListener("change", () => radio.checked && this.events.histColumn(col.name));
      const label = el("label", { title: col.name }, [
        radio,
        el("span", { className: "name", textContent: col.name }),
      ]);
      const li = el("li", { className: usable ? "" : "disabled" }, [label]);
      li.dataset.name = col.name.toLowerCase();
      columnMenu(li, col, m);
      if (!usable) li.append(el("span", { className: "tag", textContent: col.kind }));
      return li;
    });
    this.list.replaceChildren(...items);
  }

  private renderYs(m: PanelModel): void {
    this.yTitle.textContent = "Y series ";
    this.clear.hidden = false;
    const axisCount = m.assignment.axes.length;
    this.yCount.textContent = m.ys.length ? `(${m.ys.length})` : "";
    const items = m.table.columns.map((col) => {
      const checked = m.ys.includes(col.name);
      const plottable = col.kind !== "text" && col.name !== m.x;
      const box = el("input", { type: "checkbox", checked, disabled: !plottable });
      box.addEventListener("change", () => this.events.toggleY(col.name, box.checked));
      const swatch = el("span", { className: "swatch" });
      const style = seriesStyle(col, m.dark);
      swatch.style.borderTopColor = style.color;
      swatch.style.borderTopStyle = style.dash;
      const label = el("label", { title: col.name }, [
        box,
        swatch,
        el("span", { className: "name", textContent: col.name }),
      ]);
      const li = el("li", { className: plottable ? "" : "disabled" }, [label]);
      li.dataset.name = col.name.toLowerCase();
      columnMenu(li, col, m);
      if (!plottable) {
        li.append(
          el("span", { className: "tag", textContent: col.kind === "text" ? "text" : "X" }),
        );
      } else if (checked) {
        li.append(this.axisSelect(col.name, axisCount, m));
      }
      return li;
    });
    this.list.replaceChildren(...items);
  }

  private axisSelect(name: string, axisCount: number, m: PanelModel): HTMLSelectElement {
    const current = (m.assignment.axisOf[name] ?? 0) + 1;
    const options: [string, string][] = [[AUTO, `Y${current} (auto)`]];
    for (let i = 1; i <= axisCount; i++) options.push([String(i), `Y${i}`]);
    if (axisCount < 4) options.push([String(axisCount + 1), "New axis"]);
    const override = m.axisOverrides[name];
    const s = select(
      options,
      override ? String(Math.min(override, axisCount)) : AUTO,
      (v) => this.events.axis(name, v ? Number(v) : undefined),
      "Y axis for this column (auto = grouped by unit)",
    );
    s.className = "axis-tag";
    return s;
  }

  private applyFilter(): void {
    const q = this.filter.value.trim().toLowerCase();
    for (const li of Array.from(this.list.children) as HTMLElement[]) {
      li.hidden = q !== "" && !(li.dataset.name ?? "").includes(q);
    }
  }
}

/** Right-click on a column row: plot only it, its histogram, use it as X, copy its name. */
function columnMenu(li: HTMLElement, col: Column, m: PanelModel): void {
  setMenuContext(li, {
    webviewSection: "column",
    column: col.name,
    plottable: col.kind !== "text" && col.name !== m.x,
    isNumber: col.kind === "number",
    isX: col.name === m.x && m.mode !== "histogram",
  });
}
