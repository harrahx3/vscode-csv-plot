/** Descriptive statistics and histogram bins of a numeric column (pure, testable). */

export interface ColumnStats {
  /** Non-missing values. */
  count: number;
  /** Missing (empty or unreadable) cells. */
  missing: number;
  sum: number;
  mean: number;
  /** Sample standard deviation (n - 1 denominator); NaN with fewer than 2 values. */
  stdDev: number;
  min: number;
  /** 25th percentile. */
  q1: number;
  median: number;
  /** 75th percentile. */
  q3: number;
  max: number;
}

export interface Histogram {
  /** Left edge of the first bin. */
  start: number;
  /** Width of every bin. */
  width: number;
  /** Values per bin; bin i covers [start + i·width, start + (i+1)·width), the last one is closed. */
  counts: number[];
}

/** The finite values of a column, sorted ascending. */
export function sortedValues(values: Float64Array): Float64Array {
  let n = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) n++;
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) out[j++] = values[i];
  return out.sort();
}

/** Percentile p (0..1) of sorted values, interpolated linearly (as Excel PERCENTILE.INC). */
export function quantile(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function columnStats(values: Float64Array, sorted = sortedValues(values)): ColumnStats {
  const n = sorted.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const mean = n ? sum / n : NaN;
  let squares = 0;
  for (let i = 0; i < n; i++) squares += (sorted[i] - mean) ** 2;
  return {
    count: n,
    missing: values.length - n,
    sum: n ? sum : NaN,
    mean,
    stdDev: n > 1 ? Math.sqrt(squares / (n - 1)) : NaN,
    min: n ? sorted[0] : NaN,
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: n ? sorted[n - 1] : NaN,
  };
}

export const MAX_BINS = 200;

/**
 * Number of bins chosen automatically: the Freedman–Diaconis rule (robust to outliers),
 * falling back to Sturges' rule when the interquartile range is zero.
 */
export function autoBinCount(sorted: Float64Array): number {
  const n = sorted.length;
  if (n === 0) return 1;
  const range = sorted[n - 1] - sorted[0];
  if (range === 0) return 1;
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const sturges = Math.ceil(Math.log2(n)) + 1;
  const bins = iqr > 0 ? Math.ceil(range / ((2 * iqr) / Math.cbrt(n))) : sturges;
  return Math.min(Math.max(bins, 1), MAX_BINS);
}

/** Rounds a bin width up to 1, 2, 2.5 or 5 × a power of ten, for readable bin edges. */
export function niceWidth(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= raw * (1 - 1e-9)) ?? 10;
  return step * power;
}

/** Index of the first sorted value >= `value` (or > `value` when `after`). */
function bound(sorted: Float64Array, value: number, after = false): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value || (after && sorted[mid] === value)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Number of sorted values in [from, to]. */
export function countBetween(sorted: Float64Array, from: number, to: number): number {
  return Math.max(0, bound(sorted, to, true) - bound(sorted, from));
}

/**
 * Splits the sorted values into about `targetBins` bins of a round width, aligned on a
 * multiple of that width. Whole-number data gets whole-number bin widths.
 * With a `range` (a zoomed window), the bins cover that range only; bins cut by its edges
 * still count all their values.
 */
export function histogram(
  sorted: Float64Array,
  targetBins = autoBinCount(sorted),
  range?: [number, number],
): Histogram {
  const n = sorted.length;
  if (n === 0) return { start: 0, width: 1, counts: [] };
  const min = sorted[0];
  const max = sorted[n - 1];
  if (min === max) {
    const width = niceWidth(Math.abs(min) / 10 || 1);
    return { start: min - width / 2, width, counts: [n] };
  }
  const [from, to] = range && range[1] > range[0] ? range : [min, max];
  let width = niceWidth((to - from) / Math.max(1, targetBins));
  const integers = sorted.every(Number.isInteger);
  if (integers) width = Math.max(1, Math.round(width));
  // Whole numbers sit in the middle of their bin (0 in [-0.5, 0.5)), not on an edge.
  let start = Math.floor(from / width) * width - (integers ? 0.5 : 0);
  if (start + width <= from) start += width;
  const binCount = Math.max(1, Math.ceil((to - start) / width - 1e-9));
  const end = start + binCount * width;
  const counts = new Array<number>(binCount).fill(0);
  // Whole column: every value. Zoomed: values in [start, end), plus the column maximum when
  // it sits on the last edge (the last bin of the column is closed).
  const first = range ? bound(sorted, start) : 0;
  const last = !range || max <= end ? n : bound(sorted, end);
  for (let i = first; i < last; i++) {
    const bin = Math.floor((sorted[i] - start) / width);
    counts[Math.min(Math.max(bin, 0), binCount - 1)]++;
  }
  return { start, width, counts };
}
