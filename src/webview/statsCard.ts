/** Card beside the histogram: bin count setting and the statistics of the column. */
import type { ZoomWindow } from "./histogramZoom";
import type { ColumnStats } from "./stats";
import { formatNumber } from "./tooltip";

export const BIN_CHOICES = [10, 20, 50, 100];

export interface StatsCardModel {
  stats: ColumnStats;
  /** Bins chosen by hand; undefined = automatic. */
  binsOverride?: number;
  /** Bins actually drawn. */
  binCount: number;
  /** Zoomed range of the chart; undefined = whole column. */
  zoom?: ZoomWindow;
}

const ROWS: [label: string, key: keyof ColumnStats, title?: string][] = [
  ["Count", "count", "Cells holding a number"],
  ["Missing", "missing", "Empty or unreadable cells"],
  ["Mean", "mean"],
  ["Median", "median"],
  ["Standard deviation", "stdDev", "Sample standard deviation (n − 1)"],
  ["Minimum", "min"],
  ["25th percentile", "q1", "First quartile, linear interpolation (as Excel PERCENTILE.INC)"],
  ["75th percentile", "q3", "Third quartile, linear interpolation (as Excel PERCENTILE.INC)"],
  ["Maximum", "max"],
  ["Sum", "sum"],
];

export class StatsCard {
  private readonly bins = document.createElement("select");
  private readonly table = document.createElement("table");
  private readonly zoomNote = document.createElement("p");

  constructor(
    private readonly root: HTMLElement,
    onBins: (bins: number | undefined) => void,
  ) {
    this.bins.id = "bins-select";
    this.bins.title = "Number of bins (auto = Freedman–Diaconis rule)";
    this.bins.addEventListener("change", () =>
      onBins(this.bins.value ? Number(this.bins.value) : undefined),
    );
    const label = document.createElement("label");
    label.className = "bins";
    label.append(Object.assign(document.createElement("span"), { textContent: "Bins" }), this.bins);
    this.table.className = "stats-table";
    this.zoomNote.className = "zoom-note";
    this.zoomNote.hidden = true;
    root.append(label, this.zoomNote, this.table);
  }

  render(m: StatsCardModel): void {
    const options: [string, string][] = [
      ["", `Auto (${m.binCount})`],
      ...BIN_CHOICES.map((b): [string, string] => [String(b), `about ${b}`]),
    ];
    this.bins.replaceChildren(
      ...options.map(([value, textContent]) =>
        Object.assign(document.createElement("option"), { value, textContent }),
      ),
    );
    this.bins.value = m.binsOverride ? String(m.binsOverride) : "";
    this.renderZoom(m);

    this.table.replaceChildren(
      ...ROWS.map(([label, key, title]) => {
        const tr = document.createElement("tr");
        tr.dataset.stat = key;
        if (title) tr.title = title;
        const value = m.stats[key];
        const text = key === "count" || key === "missing" ? String(value) : formatNumber(value);
        tr.append(
          Object.assign(document.createElement("th"), { textContent: label }),
          Object.assign(document.createElement("td"), { textContent: text }),
        );
        return tr;
      }),
    );
  }

  /** Only the bin count and the zoom note change on a zoom. */
  renderZoom(m: Pick<StatsCardModel, "stats" | "binCount" | "zoom">): void {
    const auto = this.bins.options[0];
    if (auto) auto.textContent = `Auto (${m.binCount})`;
    const z = m.zoom;
    this.zoomNote.hidden = !z;
    if (!z) return;
    const share = m.stats.count ? ((100 * z.count) / m.stats.count).toFixed(1) : "0";
    this.zoomNote.textContent =
      `Zoomed on ${formatNumber(z.from)} – ${formatNumber(z.to)}: ${z.count} values ` +
      `(${share} %). The statistics below cover the whole column.`;
  }

  show(visible: boolean): void {
    this.root.hidden = !visible;
  }
}
