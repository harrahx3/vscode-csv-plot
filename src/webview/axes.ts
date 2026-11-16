/**
 * Automatic Y-axis grouping. Columns that share a unit (read from the column name) share
 * an axis; columns without a unit are grouped by order of magnitude. No list of known units
 * is used, so the rule works with any naming scheme following the conventions below.
 */

export const MAX_AXES = 4;
/** Two unit-less columns share an axis when their largest values differ by less than this factor. */
export const MAGNITUDE_FACTOR = 10;

export interface Unit {
  /** Comparison key (lower case). */
  key: string;
  /** Text shown on the axis. */
  label: string;
}

/**
 * Unit of a column, from its name:
 * - trailing brackets: `Power [kW]` -> kW, `Temp (°C)` -> °C;
 * - otherwise the part after the last underscore: `heat_kw` -> kw; a compound unit
 *   written with `_per_` is kept whole: `mdot_kg_per_s` -> kg_per_s;
 * - a purely numeric suffix (`sensor_2`) is not a unit.
 */
export function unitOf(name: string): Unit | null {
  const trimmed = name.trim();
  const bracket = /[[(]\s*([^[\]()]+?)\s*[\])]$/.exec(trimmed);
  if (bracket) return makeUnit(bracket[1]);
  const compound = /_([^_\s]+(?:_per_[^_\s]+)+)$/i.exec(trimmed);
  if (compound) return makeUnit(compound[1]);
  const cut = trimmed.lastIndexOf("_");
  if (cut <= 0 || cut === trimmed.length - 1) return null;
  const suffix = trimmed.slice(cut + 1);
  if (/^\d+$/.test(suffix) || /\s/.test(suffix)) return null;
  return makeUnit(suffix);
}

function makeUnit(label: string): Unit {
  return { key: label.toLowerCase(), label };
}

export interface AxisSeries {
  name: string;
  maxAbs: number;
}

export interface Axis {
  /** Unit key shared by the axis' automatic members; null for a magnitude-based axis. */
  unitKey: string | null;
  /** Distinct unit labels of the members, for the axis title. */
  labels: string[];
  maxAbs: number;
  members: string[];
}

export interface AxisAssignment {
  axes: Axis[];
  /** Column name -> axis index (0-based). */
  axisOf: Record<string, number>;
}

/**
 * Assigns each series to an axis. Series with a manual override (1-based axis number;
 * a number beyond the existing axes means "new axis") are placed after the automatic ones.
 */
export function assignAxes(
  series: AxisSeries[],
  overrides: Record<string, number> = {},
): AxisAssignment {
  const axes: Axis[] = [];
  const axisOf: Record<string, number> = {};
  const place = (s: AxisSeries, index: number, unit: Unit | null) => {
    const axis = axes[index];
    axis.members.push(s.name);
    axis.maxAbs = Math.max(axis.maxAbs, s.maxAbs);
    if (unit && !axis.labels.includes(unit.label)) axis.labels.push(unit.label);
    axisOf[s.name] = index;
  };
  const newAxis = (unitKey: string | null): number => {
    axes.push({ unitKey, labels: [], maxAbs: 0, members: [] });
    return axes.length - 1;
  };

  for (const s of series) {
    if (overrides[s.name] !== undefined) continue;
    const unit = unitOf(s.name);
    let index = unit
      ? axes.findIndex((a) => a.unitKey === unit.key)
      : axes.findIndex((a) => a.unitKey === null && sameMagnitude(a.maxAbs, s.maxAbs));
    if (index === -1)
      index = axes.length < MAX_AXES ? newAxis(unit?.key ?? null) : closest(axes, s.maxAbs);
    place(s, index, unit);
  }

  for (const s of series) {
    const wanted = overrides[s.name];
    if (wanted === undefined) continue;
    let index = Math.max(0, Math.round(wanted) - 1);
    if (index >= axes.length) {
      index = axes.length < MAX_AXES ? newAxis(`#manual${axes.length}`) : axes.length - 1;
    }
    place(s, index, unitOf(s.name));
  }
  return { axes, axisOf };
}

function sameMagnitude(a: number, b: number): boolean {
  if (a === 0 || b === 0) return true;
  return Math.max(a, b) / Math.min(a, b) < MAGNITUDE_FACTOR;
}

function closest(axes: Axis[], maxAbs: number): number {
  const log = (v: number) => Math.log10(v || 1);
  let best = 0;
  for (let i = 1; i < axes.length; i++) {
    if (
      Math.abs(log(axes[i].maxAbs) - log(maxAbs)) < Math.abs(log(axes[best].maxAbs) - log(maxAbs))
    ) {
      best = i;
    }
  }
  return best;
}
