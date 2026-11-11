// Keyed row-level diff shared by CSV files and SQLite tables.
import { createHash } from "node:crypto";
import type { Cell, ChangedRow, MagnitudeShift, Row, TableDiff, TwinAnalysis } from "./types.ts";

export const SAMPLE_CAP = 2000;

export interface TableInput {
  columns: string[];
  rows: Row[];
}

export interface TableDiffOptions {
  name: string;
  key?: string[]; // forced key (declared PK / rowid)
  keySource?: TableDiff["keySource"];
  cap?: number;
}

function isEmpty(v: Cell): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function keyOf(row: Row, key: string[]): string {
  if (key.length === 1) return String(row[key[0]] ?? "");
  return key.map((k) => String(row[k] ?? "")).join("␟");
}

function rowHash(row: Row, columns: string[]): string {
  const h = createHash("sha1");
  for (const c of columns) h.update(String(row[c] ?? "␀")).update("␞");
  return h.digest("hex").slice(0, 16);
}

function sameCell(a: Cell, b: Cell): boolean {
  if (a === b) return true;
  if (isEmpty(a) && isEmpty(b)) return true;
  // CSV gives strings, SQLite gives numbers: compare numerically when both look numeric.
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== "" && b !== "") return na === nb;
  }
  return String(a) === String(b);
}

/** Pick a key column that is non-empty and unique on both sides. */
export function detectKey(a: TableInput, b: TableInput): string[] | null {
  const common = a.columns.filter((c) => b.columns.includes(c));
  const score = (c: string) => {
    const l = c.toLowerCase();
    if (l === "id") return 0;
    if (l === "uuid" || l === "key" || l === "pk") return 1;
    if (l.endsWith("_id") || l.endsWith("id")) return 2;
    return 3;
  };
  const ordered = [...common].sort((x, y) => score(x) - score(y) || common.indexOf(x) - common.indexOf(y));
  for (const c of ordered) {
    if (score(c) === 3 && c !== common[0]) continue; // only id-like names or the first column
    if (isUnique(a.rows, c) && isUnique(b.rows, c)) return [c];
  }
  return null;
}

function isUnique(rows: Row[], col: string): boolean {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r[col];
    if (isEmpty(v)) return false;
    const s = String(v);
    if (seen.has(s)) return false;
    seen.add(s);
  }
  return true;
}

/** Choose a natural-key column (e.g. email) to tell "merged duplicate" from "lost row". */
function pickTwinColumn(before: TableInput, after: TableInput, key: string[]): string | null {
  const common = before.columns.filter((c) => after.columns.includes(c) && !key.includes(c));
  const preferred = common.find((c) => /e-?mail/i.test(c));
  if (preferred) return preferred;
  let best: string | null = null;
  let bestRatio = 0.9;
  for (const c of common) {
    if (/date|time|_at$|amount|price|count|qty/i.test(c)) continue;
    const vals = new Set(before.rows.map((r) => norm(r[c])).filter((v) => v !== ""));
    const ratio = before.rows.length ? vals.size / before.rows.length : 0;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = c;
    }
  }
  return best;
}

function norm(v: Cell): string {
  return v === null || v === undefined ? "" : String(v).trim().toLowerCase();
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function diffTables(before: TableInput, after: TableInput, opts: TableDiffOptions): TableDiff {
  const cap = opts.cap ?? SAMPLE_CAP;
  const columnsAdded = after.columns.filter((c) => !before.columns.includes(c));
  const columnsRemoved = before.columns.filter((c) => !after.columns.includes(c));
  const common = after.columns.filter((c) => before.columns.includes(c));
  const columns = [...after.columns, ...columnsRemoved];

  let key = opts.key;
  let keySource: TableDiff["keySource"] = opts.keySource ?? "declared";
  if (!key || key.length === 0) {
    const detected = detectKey(before, after);
    if (detected) {
      key = detected;
      keySource = "detected";
    } else {
      key = [];
      keySource = "rowhash";
    }
  }

  const result: TableDiff = {
    name: opts.name,
    key,
    keySource,
    columns,
    columnsAdded,
    columnsRemoved,
    rowsBefore: before.rows.length,
    rowsAfter: after.rows.length,
    addedCount: 0,
    removedCount: 0,
    changedCount: 0,
    cellsChanged: 0,
    cellsFilled: 0,
    cellsCleared: 0,
    columnChangeCounts: {},
    added: [],
    removed: [],
    changed: [],
    truncated: false,
    magnitude: [],
  };

  const removedRows: Row[] = [];

  if (keySource === "rowhash") {
    // No usable key: multiset diff on whole-row hashes over the common columns.
    const counts = new Map<string, { n: number; row: Row }>();
    for (const r of before.rows) {
      const h = rowHash(r, common);
      const e = counts.get(h);
      if (e) e.n++;
      else counts.set(h, { n: 1, row: r });
    }
    for (const r of after.rows) {
      const h = rowHash(r, common);
      const e = counts.get(h);
      if (e && e.n > 0) e.n--;
      else {
        result.addedCount++;
        if (result.added.length < cap) result.added.push(r);
      }
    }
    for (const r of before.rows) {
      const h = rowHash(r, common);
      const e = counts.get(h)!;
      if (e.n > 0) {
        e.n--;
        result.removedCount++;
        removedRows.push(r);
        if (result.removed.length < cap) result.removed.push(r);
      }
    }
  } else {
    const beforeMap = new Map<string, Row>();
    for (const r of before.rows) beforeMap.set(keyOf(r, key), r);
    const seen = new Set<string>();
    const ratios = new Map<string, number[]>();
    for (const r of after.rows) {
      const k = keyOf(r, key);
      const old = beforeMap.get(k);
      if (!old) {
        result.addedCount++;
        if (result.added.length < cap) result.added.push(r);
        continue;
      }
      seen.add(k);
      let cells: ChangedRow["cells"] | null = null;
      for (const c of common) {
        const a = old[c] ?? null;
        const b = r[c] ?? null;
        if (sameCell(a, b)) continue;
        (cells ??= {})[c] = { before: a, after: b };
        result.cellsChanged++;
        result.columnChangeCounts[c] = (result.columnChangeCounts[c] ?? 0) + 1;
        if (isEmpty(a)) result.cellsFilled++;
        else if (isEmpty(b)) result.cellsCleared++;
        const na = Number(a);
        const nb = Number(b);
        if (!/(^|_)id$/i.test(c) && !isEmpty(a) && !isEmpty(b) && Number.isFinite(na) && Number.isFinite(nb) && na !== 0 && nb !== 0) {
          const f = nb / na;
          if (f >= 10 || f <= 0.1) {
            const list = ratios.get(c) ?? [];
            list.push(f);
            ratios.set(c, list);
          }
        }
      }
      if (cells) {
        result.changedCount++;
        if (result.changed.length < cap) result.changed.push({ key: k, cells, row: r });
      }
    }
    for (const [k, r] of beforeMap) {
      if (seen.has(k)) continue;
      result.removedCount++;
      removedRows.push(r);
      if (result.removed.length < cap) result.removed.push(r);
    }
    for (const [column, list] of ratios) {
      result.magnitude.push({ column, count: list.length, medianFactor: median(list) } satisfies MagnitudeShift);
    }
  }

  result.truncated =
    result.addedCount > result.added.length ||
    result.removedCount > result.removed.length ||
    result.changedCount > result.changed.length;

  if (removedRows.length > 0) {
    const col = pickTwinColumn(before, after, key);
    if (col) {
      const survivors = new Set(after.rows.map((r) => norm(r[col])));
      const twins: TwinAnalysis = { column: col, matched: 0, unmatched: 0, unmatchedKeys: [] };
      for (const r of removedRows) {
        if (survivors.has(norm(r[col])) && norm(r[col]) !== "") twins.matched++;
        else {
          twins.unmatched++;
          if (twins.unmatchedKeys.length < cap) twins.unmatchedKeys.push(key.length ? keyOf(r, key) : rowHash(r, common));
        }
      }
      result.twins = twins;
    }
  }

  return result;
}
