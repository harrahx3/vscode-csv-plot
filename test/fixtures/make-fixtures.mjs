// Generates synthetic CSV and Excel files for the browser and VS Code tests (and for trying the
// extension by hand). Usage: node test/fixtures/make-fixtures.mjs [outDir]  (default: out/fixtures)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hourlyXls } from "./make-xls.mjs";
import { hourlyWorkbook } from "./make-xlsx.mjs";

const outDir = process.argv[2] ?? "out/fixtures";
mkdirSync(outDir, { recursive: true });

const pad = (n) => String(n).padStart(2, "0");
const stamp = (h) => {
  const d = new Date(Date.UTC(2020, 0, 1, h));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00`;
};

/** One year hourly, ';' separated, decimal comma, units as suffixes. */
export function hourlySemicolon(hours = 8760) {
  const lines = ["timestamp;q_demand_kw;q_hp_kw;q_boiler_kw;p_el_kw;t_out_c;t_in_c;mdot_kg_per_s;storage_kw;comment"];
  for (let h = 0; h < hours; h++) {
    const day = Math.sin((2 * Math.PI * (h % 24)) / 24);
    const season = Math.cos((2 * Math.PI * h) / 8760);
    const demand = 120 + 80 * season + 25 * day;
    const hp = Math.min(demand, 90);
    const boiler = demand - hp;
    const storage = 20 * Math.sin((2 * Math.PI * h) / 48);
    const f = (v) => v.toFixed(2).replace(".", ",");
    lines.push(
      [stamp(h), f(demand), f(hp), f(boiler), f(hp / 3.2), f(70 + 5 * season), f(40 + 3 * day), f(demand / 125.4), f(storage), h % 500 === 0 ? "check" : ""].join(";"),
    );
  }
  return lines.join("\n") + "\n";
}

/** Comma separated, no timestamp, unit-less columns of very different magnitudes. */
export function plainComma(rows = 500) {
  const lines = ["alpha,beta,gamma,label"];
  for (let i = 0; i < rows; i++) lines.push(`${Math.sin(i / 20).toFixed(4)},${(1000 + 300 * Math.cos(i / 30)).toFixed(1)},${i % 7},row${i}`);
  return lines.join("\n") + "\n";
}

/** Many rows for the performance check: comma separated, row number as X. */
export function large(rows = 1_000_000, cols = 20) {
  const header = Array.from({ length: cols }, (_, c) => `s${c}_kw`).join(",");
  const parts = [header];
  for (let i = 0; i < rows; i++) {
    let line = "";
    for (let c = 0; c < cols; c++) line += (c ? "," : "") + ((i * (c + 1)) % 997) / 10;
    parts.push(line);
  }
  return parts.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(join(outDir, "hourly_semicolon.csv"), hourlySemicolon());
  writeFileSync(join(outDir, "plain_comma.csv"), plainComma());
  writeFileSync(join(outDir, "plant.xlsx"), hourlyWorkbook());
  writeFileSync(join(outDir, "plant.xls"), hourlyXls());
  writeFileSync(join(outDir, "résultats - Copy.xlsx"), hourlyWorkbook(100));
  console.log(`fixtures written to ${outDir}`);
}
