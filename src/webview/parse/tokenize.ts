/**
 * CSV tokenizer: splits text into rows of fields with a single-character separator,
 * honouring double-quoted fields (RFC 4180: "" is an escaped quote, quoted fields may
 * contain separators and newlines). Lines without any quote take a fast `split` path.
 * Blank lines are skipped. A leading byte-order mark is ignored.
 */

/** Called once per row; return `false` to stop early. */
export type RowCallback = (fields: string[], rowIndex: number) => boolean | void;

export function forEachRow(
  text: string,
  separator: string,
  onRow: RowCallback,
  maxRows = Infinity,
): void {
  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let row = 0;
  // Position of the next double quote at or after `pos` (n if none); cached so each
  // quote is searched for once, keeping the whole scan linear.
  let nextQuote = -1;
  while (pos < n && row < maxRows) {
    let end = text.indexOf("\n", pos);
    if (end === -1) end = n;
    let lineEnd = end;
    if (lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
    if (nextQuote < pos) {
      nextQuote = text.indexOf('"', pos);
      if (nextQuote === -1) nextQuote = n;
    }
    let fields: string[];
    if (nextQuote >= lineEnd) {
      fields = text.slice(pos, lineEnd).split(separator);
      pos = end + 1;
    } else {
      const parsed = parseQuotedRow(text, pos, separator);
      fields = parsed.fields;
      pos = parsed.next;
    }
    if (fields.length === 1 && fields[0].trim() === "") continue;
    if (onRow(fields, row++) === false) return;
  }
}

/** Slow path for a row that contains at least one double quote. */
function parseQuotedRow(
  text: string,
  start: number,
  separator: string,
): { fields: string[]; next: number } {
  const n = text.length;
  const fields: string[] = [];
  let i = start;
  for (;;) {
    let value = "";
    if (text[i] === '"') {
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q === -1) {
          value += text.slice(i);
          i = n;
          break;
        }
        value += text.slice(i, q);
        if (text[q + 1] === '"') {
          value += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
    }
    // Unquoted field, or stray characters after a closing quote.
    let j = i;
    while (j < n && text[j] !== separator && text[j] !== "\n" && text[j] !== "\r") j++;
    value += text.slice(i, j);
    fields.push(value);
    i = j;
    if (i >= n) return { fields, next: n };
    if (text[i] === separator) {
      i++;
      continue;
    }
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
    return { fields, next: i };
  }
}

/** Upper bound of the number of rows (quoted newlines only make it larger). */
export function countLinesUpperBound(text: string): number {
  let count = 1;
  let i = -1;
  while ((i = text.indexOf("\n", i + 1)) !== -1) count++;
  return count;
}
