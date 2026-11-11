// Typed data diff of a PR, reusing the delta diff engine, plus PR-specific rules
// for a product catalog (prices, removed products, fitment, stock).
import { parseCsv } from "../../server/diff/csv.ts";
import { diffTables } from "../../server/diff/table.ts";
import { jsonPathDiff } from "../../server/diff/json.ts";
import { tableSummary } from "../../server/diff/engine.ts";
import type { Cell, JsonChange, Row, TableDiff } from "../../server/diff/types.ts";

export type RuleId = "price" | "removed" | "fitment" | "stock";

export interface RuleHit {
  rule: RuleId;
  file: string;
  key: string; // row key or JSON path
  label: string; // human name (slug or product name)
  column: string;
  before: Cell | unknown;
  after: Cell | unknown;
  note: string; // e.g. "÷100", "−99%", "fitment lost"
  severity: "high" | "medium";
}

/** high: price drop over 50% (incl. ÷100), product removed, fitment lost. medium: stock to 0, price up over 50%. */
export function severityOf(h: Omit<RuleHit, "severity">): RuleHit["severity"] {
  if (h.rule === "stock") return "medium";
  if (h.rule === "price") {
    const b = Number(h.before);
    const a = Number(h.after);
    return Number.isFinite(a) && Number.isFinite(b) && a > b ? "medium" : "high";
  }
  return "high";
}

export interface CsvReport {
  kind: "csv";
  path: string;
  status: string;
  key: string;
  rowsBefore: number;
  rowsAfter: number;
  added: number;
  removed: number;
  changed: number;
  cellsChanged: number;
  summary: string;
  columnChangeCounts: Record<string, number>;
  changedRows: { key: string; label: string; cells: Record<string, { before: Cell; after: Cell }> }[];
  removedRows: { key: string; label: string; row: Row }[];
  addedRows: { key: string; label: string; row: Row }[];
  okPriceChanges: { count: number; minPct: number; maxPct: number };
}

export interface JsonReport {
  kind: "json";
  path: string;
  status: string;
  total: number;
  changes: JsonChange[];
  summary: string;
}

export interface OtherReport {
  kind: "code" | "data-unparsed";
  path: string;
  status: string;
  note: string;
}

export type FileReport = CsvReport | JsonReport | OtherReport;

const DATA_EXT = /\.(csv|tsv|json|jsonl|ya?ml|sqlite3?|db)$/i;
export const isDataFile = (p: string) => DATA_EXT.test(p);

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const empty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

const PRICE_COL = /(^|[:_.])(price|priceUzs|salePrice|amount|cost)$/i;
const STOCK_COL = /(stock|stockOnHand|inventory|quantity|qty)$/i;
const FIT_COL = /(compatibleVehicleSlugs|vehicleSlugs|fitment|compatible)/i;

function priceNote(b: number, a: number): string | null {
  if (b <= 0) return null;
  const f = a / b;
  if (f > 0.5 && f < 1.5) return null;
  const r = f < 1 ? 1 / f : f;
  const pow = [10, 100, 1000].find((p) => Math.abs(r / p - 1) < 0.08);
  const pct = `${f >= 1 ? "+" : "−"}${Math.abs((f - 1) * 100).toFixed(0)}%`;
  if (pow) return `${f < 1 ? "÷" : "×"}${pow} · ${pct}`;
  return pct;
}

function pickKey(cols: string[]): string | undefined {
  return ["sku", "slug", "id", "code"].find((c) => cols.includes(c));
}

export function analyzeCsv(path: string, status: string, before: string, after: string, hits: RuleHit[]): CsvReport {
  const A = parseCsv(before);
  const B = parseCsv(after);
  const key = pickKey(A.columns.length ? A.columns : B.columns);
  const t: TableDiff = diffTables(A, B, key ? { name: path, key: [key], keySource: "detected" } : { name: path });
  const labelOf = (r: Row | undefined, k: string) => String((r && (r.slug || r.name)) || k);
  const beforeByKey = new Map<string, Row>();
  if (key) for (const r of A.rows) beforeByKey.set(String(r[key]), r);

  let okCount = 0;
  let minPct = Infinity;
  let maxPct = -Infinity;
  for (const c of t.changed) {
    const label = labelOf(c.row, c.key);
    for (const [col, ch] of Object.entries(c.cells)) {
      const b = num(ch.before);
      const a = num(ch.after);
      if (PRICE_COL.test(col) && b !== null && a !== null) {
        const note = priceNote(b, a);
        if (note) pushHit(hits, { rule: "price", file: path, key: c.key, label, column: col, before: ch.before, after: ch.after, note });
        else if (b > 0) {
          okCount++;
          const pct = (a / b - 1) * 100;
          minPct = Math.min(minPct, pct);
          maxPct = Math.max(maxPct, pct);
        }
      }
      if (STOCK_COL.test(col) && b !== null && b > 0 && a === 0)
        pushHit(hits, { rule: "stock", file: path, key: c.key, label, column: col, before: ch.before, after: ch.after, note: "out of stock" });
      if (FIT_COL.test(col) && !empty(ch.before) && empty(ch.after))
        pushHit(hits, { rule: "fitment", file: path, key: c.key, label, column: col, before: ch.before, after: ch.after, note: "fitment lost" });
    }
  }
  for (const r of t.removed) {
    const k = key ? String(r[key]) : "";
    pushHit(hits, { rule: "removed", file: path, key: k, label: labelOf(r, k), column: "row", before: r.name ?? k, after: null, note: "product removed" });
  }
  return {
    kind: "csv",
    path,
    status,
    key: key ?? t.key.join(",") ?? "row hash",
    rowsBefore: t.rowsBefore,
    rowsAfter: t.rowsAfter,
    added: t.addedCount,
    removed: t.removedCount,
    changed: t.changedCount,
    cellsChanged: t.cellsChanged,
    summary: tableSummary(t),
    columnChangeCounts: t.columnChangeCounts,
    changedRows: t.changed.map((c) => ({ key: c.key, label: labelOf(c.row ?? beforeByKey.get(c.key), c.key), cells: c.cells })),
    removedRows: t.removed.map((r) => ({ key: key ? String(r[key]) : "", label: labelOf(r, ""), row: r })),
    addedRows: t.added.map((r) => ({ key: key ? String(r[key]) : "", label: labelOf(r, ""), row: r })),
    okPriceChanges: { count: okCount, minPct: okCount ? minPct : 0, maxPct: okCount ? maxPct : 0 },
  };
}

/** Arrays of objects with a unique sku/slug/code are keyed by it, so paths read products[sku=GG-0057].priceUzs. */
function keyArrays(v: unknown): unknown {
  if (Array.isArray(v)) {
    const k = ["sku", "slug", "code", "id"].find((kk) => v.length > 0 && v.every((x) => x && typeof x === "object" && kk in x) && new Set(v.map((x) => String((x as Record<string, unknown>)[kk]))).size === v.length);
    if (k) return Object.fromEntries(v.map((x) => [`${k}=${(x as Record<string, unknown>)[k]}`, keyArrays(x)]));
    return v.map(keyArrays);
  }
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([a, b]) => [a, keyArrays(b)]));
  return v;
}

export function analyzeJson(path: string, status: string, before: string, after: string, hits: RuleHit[]): JsonReport {
  let changes: JsonChange[];
  try {
    const a = before ? JSON.parse(before) : undefined;
    const b = after ? JSON.parse(after) : undefined;
    changes = jsonPathDiff(keyArrays(a), keyArrays(b)).map((c) => ({ ...c, path: c.path.replace(/\["((?:sku|slug|code|id)=[^"]+)"\]/g, "[$1]") }));
  } catch (e) {
    return { kind: "json", path, status, total: 0, changes: [], summary: `could not parse JSON: ${(e as Error).message}` };
  }
  for (const c of changes) {
    const leaf = c.path.split(".").pop() ?? c.path;
    const label = c.path.match(/\[(?:sku|slug|code|id)=([^\]]+)\]/)?.[1] ?? c.path;
    if (c.kind === "changed" && PRICE_COL.test(leaf)) {
      const b = num(c.before);
      const a = num(c.after);
      const note = b !== null && a !== null ? priceNote(b, a) : null;
      if (note) pushHit(hits, { rule: "price", file: path, key: c.path, label, column: leaf, before: c.before, after: c.after, note });
    }
    if (c.kind === "changed" && STOCK_COL.test(leaf) && (num(c.before) ?? 0) > 0 && num(c.after) === 0)
      pushHit(hits, { rule: "stock", file: path, key: c.path, label, column: leaf, before: c.before, after: c.after, note: "out of stock" });
    if (FIT_COL.test(c.path) && !empty(c.before) && (c.kind === "removed" || empty(c.after)) && !/\[\d+\]$/.test(c.path))
      pushHit(hits, { rule: "fitment", file: path, key: c.path, label, column: leaf, before: c.before, after: c.after, note: "fitment lost" });
  }
  const counts = { changed: 0, added: 0, removed: 0 };
  for (const c of changes) counts[c.kind]++;
  const parts = [counts.changed && `${counts.changed} value${counts.changed === 1 ? "" : "s"} changed`, counts.added && `+${counts.added} paths`, counts.removed && `−${counts.removed} paths`].filter(Boolean);
  return { kind: "json", path, status, total: changes.length, changes, summary: parts.join(" · ") || "no value changes (formatting only)" };
}

function pushHit(hits: RuleHit[], h: Omit<RuleHit, "severity">): void {
  hits.push({ ...h, severity: severityOf(h) });
}
