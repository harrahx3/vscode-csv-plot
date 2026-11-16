/** Automatic detection of the column separator and the decimal mark. */
import { forEachRow } from "./tokenize";

export const SEPARATORS = [",", ";", "\t", "|"] as const;
export const DECIMALS = [".", ","] as const;

export interface Detection {
  value: string;
  /** False when the guess is shaky; the UI then asks the user to check it. */
  confident: boolean;
}

const SAMPLE_ROWS = 50;
const DECIMAL_COMMA_NUMBER = /^[+-]?\d*,\d+(?:[eE][+-]?\d+)?$/;
const DECIMAL_DOT_NUMBER = /^[+-]?\d*\.\d+(?:[eE][+-]?\d+)?$/;

interface Score {
  separator: string;
  columns: number;
  score: number;
  consistency: number;
}

function scoreSeparator(text: string, separator: string): Score {
  const counts = new Map<number, number>();
  let rows = 0;
  let fields = 0;
  let clean = 0;
  const others = SEPARATORS.filter((s) => s !== separator);
  forEachRow(
    text,
    separator,
    (row) => {
      rows++;
      counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
      for (const f of row) {
        fields++;
        const dirty = others.some((o) => f.includes(o));
        if (!dirty || (separator !== "," && DECIMAL_COMMA_NUMBER.test(f.trim()))) clean++;
      }
    },
    SAMPLE_ROWS,
  );
  let columns = 1;
  let frequency = 0;
  for (const [count, freq] of counts) {
    if (freq > frequency || (freq === frequency && count > columns)) {
      columns = count;
      frequency = freq;
    }
  }
  const consistency = rows ? frequency / rows : 0;
  const cleanShare = fields ? clean / fields : 0;
  const score = columns > 1 ? consistency * (0.5 + 0.5 * cleanShare) : 0;
  return { separator, columns, score, consistency };
}

export function detectSeparator(text: string): Detection {
  const scores = SEPARATORS.map((s) => scoreSeparator(text, s)).sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (best.score === 0) {
    // One column only: confident if no candidate character appears at all.
    const head = text.slice(0, 10_000);
    return { value: ",", confident: !SEPARATORS.some((s) => head.includes(s)) };
  }
  const confident = best.consistency >= 0.9 && second.score < best.score * 0.9;
  return { value: best.separator, confident };
}

/** Detects the decimal mark from sample data fields (header excluded). */
export function detectDecimal(separator: string, fields: string[]): Detection {
  if (separator === ",") return { value: ".", confident: true };
  let comma = 0;
  let dot = 0;
  for (const raw of fields) {
    const f = raw.trim();
    if (DECIMAL_COMMA_NUMBER.test(f)) comma++;
    else if (DECIMAL_DOT_NUMBER.test(f)) dot++;
  }
  if (comma > dot) return { value: ",", confident: dot === 0 };
  return { value: ".", confident: comma === 0 };
}
