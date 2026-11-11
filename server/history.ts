// Time-travel query: follow one value (an id, email, name...) or one SQL scalar
// across every checkpoint of an agent and say when it appeared, changed or vanished.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv } from "./diff/csv.ts";
import { detectKey } from "./diff/table.ts";
import type { WorldReader } from "./diff/engine.ts";
import type { Cell, Row } from "./diff/types.ts";

interface Table {
  file: string;
  table?: string;
  key: string;
  columns: string[];
  rows: Row[];
}

export interface TrackState {
  world: string;
  step: number;
  present: boolean;
  changed?: { column: string; before: Cell; after: Cell }[];
}

export interface TrackEvent {
  world: string;
  step: number;
  stepName?: string;
  kind: "appeared" | "vanished" | "reappeared" | "changed";
  detail: string;
  source?: string; // provenance: URL the agent recorded for this value (notes/enrichment_sources.json)
}

export interface Track {
  id: string;
  where: string; // customers.csv or crm.sqlite › deals
  key: string;
  label: string;
  states: TrackState[];
  events: TrackEvent[];
  sentence: string;
  row?: Row;
}

export interface HistoryResult {
  query: string;
  agent: string;
  mode: "value" | "sql";
  scanned: number;
  ms: number;
  chain: { world: string; step: number; stepName?: string }[];
  tracks: Track[];
  series?: { world: string; step: number; value: number | string | null }[];
  sentence: string;
  matchedRows: number;
}

// Parsed tables are cached by content hash: checkpoints are immutable, so this never goes stale.
const tableCache = new Map<string, Table[]>();
const sqliteDir = join(tmpdir(), "delta-sqlite-cache");

const norm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

async function sqlitePath(reader: WorldReader, path: string, hash: string): Promise<string> {
  const local = reader.localPath?.(path);
  if (local && existsSync(local)) return local;
  mkdirSync(sqliteDir, { recursive: true });
  const p = join(sqliteDir, `${hash}.sqlite`);
  if (!existsSync(p)) writeFileSync(p, await reader.read(path));
  return p;
}

async function tablesOf(reader: WorldReader, path: string, hash: string): Promise<Table[]> {
  const hit = tableCache.get(hash + path);
  if (hit) return hit;
  let out: Table[] = [];
  if (/\.(csv|tsv)$/i.test(path)) {
    const t = parseCsv((await reader.read(path)).toString("utf8"));
    const key = detectKey(t, t)?.[0] ?? t.columns[0];
    out = [{ file: path, key, columns: t.columns, rows: t.rows }];
  } else if (/\.(sqlite3?|db)$/i.test(path)) {
    const db = new DatabaseSync(await sqlitePath(reader, path, hash), { readOnly: true });
    try {
      const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
      for (const name of names) {
        const info = db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as { name: string; pk: number }[];
        const pk = info.find((c) => c.pk === 1)?.name;
        const rows = db.prepare(`SELECT ${pk ? "" : "rowid AS __rowid, "}* FROM "${name.replace(/"/g, '""')}"`).all() as Row[];
        out.push({ file: path, table: name, key: pk ?? "__rowid", columns: info.map((c) => c.name), rows });
      }
    } finally {
      db.close();
    }
  }
  if (tableCache.size > 400) tableCache.clear();
  tableCache.set(hash + path, out);
  return out;
}

function matches(t: Table, q: string, numeric: boolean, substring: boolean): Row[] {
  const nq = norm(q);
  return t.rows.filter((r) => {
    if (norm(r[t.key]) === nq) return true;
    for (const c of t.columns) {
      if (c === t.key) continue;
      const v = r[c];
      if (numeric) {
        if (/(^|_)id$/i.test(c) && norm(v) === nq) return true;
      } else if (typeof v === "string") {
        const nv = norm(v);
        if (nv === nq || (substring && nv.includes(nq))) return true;
      }
    }
    return false;
  });
}

function show(v: Cell): string {
  if (v === null || v === undefined || v === "") return "empty";
  return typeof v === "number" ? v.toLocaleString("en-US") : String(v);
}

export async function historySearch(
  query: string,
  agent: string,
  chain: { world: string; step: number; stepName?: string }[],
  reader: (world: string) => WorldReader,
): Promise<HistoryResult> {
  const t0 = performance.now();
  const q = query.trim();
  if (!q) throw new Error("type an id, email, name, or a SQL query");
  const sqlMatch = q.match(/^sql\(\s*([^,]+?)\s*,\s*"(.*)"\s*\)$/i);
  const isSql = !!sqlMatch || /^select\s/i.test(q);

  if (isSql) {
    const series = await Promise.all(
      chain.map(async (c) => {
        const r = reader(c.world);
        const m = await r.manifest();
        const path = sqlMatch?.[1] ?? Object.keys(m).find((p) => /\.(sqlite3?|db)$/i.test(p));
        if (!path || !m[path]) return { world: c.world, step: c.step, value: null };
        const db = new DatabaseSync(await sqlitePath(r, path, m[path].hash), { readOnly: true });
        try {
          const row = db.prepare(sqlMatch?.[2] ?? q).get() as Record<string, unknown> | undefined;
          const v = row ? Object.values(row)[0] : null;
          return { world: c.world, step: c.step, value: typeof v === "bigint" ? Number(v) : (v as number | string | null) };
        } finally {
          db.close();
        }
      }),
    );
    const changes = series.slice(1).map((s, i) => ({ s, prev: series[i] })).filter(({ s, prev }) => s.value !== prev.value);
    const sentence = changes.length
      ? changes.map(({ s, prev }) => `${show(prev.value as Cell)} → ${show(s.value as Cell)} at ${s.world} (${chain.find((c) => c.world === s.world)?.stepName})`).join("; ")
      : `unchanged across ${chain.length} checkpoints (${show(series[0]?.value as Cell)})`;
    return { query: q, agent, mode: "sql", scanned: chain.length, ms: Math.round(performance.now() - t0), chain, tracks: [], series, sentence, matchedRows: 0 };
  }

  const numeric = /^-?\d+$/.test(q);
  // Load every data table of every checkpoint in parallel (cached by hash after the first time).
  const perWorld = await Promise.all(
    chain.map(async (c) => {
      const r = reader(c.world);
      const m = await r.manifest();
      const files = Object.keys(m).filter((p) => /\.(csv|tsv|sqlite3?|db)$/i.test(p));
      const tables = (await Promise.all(files.map((p) => tablesOf(r, p, m[p].hash)))).flat();
      return { c, tables };
    }),
  );
  // Provenance files written by agents (company -> {source url}), per checkpoint.
  const sources = await Promise.all(
    chain.map(async (c) => {
      const r = reader(c.world);
      const m = await r.manifest();
      if (!m["notes/enrichment_sources.json"]) return null;
      try {
        return JSON.parse((await r.read("notes/enrichment_sources.json")).toString("utf8")) as Record<string, { source?: string }>;
      } catch {
        return null;
      }
    }),
  );
  let substring = false;
  const findAll = () => perWorld.map(({ c, tables }) => ({ c, hits: tables.flatMap((t) => matches(t, q, numeric, substring).map((row) => ({ t, row }))) }));
  let found = findAll();
  if (!numeric && found.every((f) => f.hits.length === 0) && q.length >= 3) {
    substring = true;
    found = findAll();
  }

  const tracks = new Map<string, Track>();
  const rowsAt = new Map<string, (Row | null)[]>();
  const keyOf = new Map<string, { col: string; val: string }>();
  found.forEach(({ hits }, i) => {
    for (const { t, row } of hits) {
      const where = t.table ? `${t.file} › ${t.table}` : t.file;
      const id = `${where}#${row[t.key]}`;
      if (!tracks.has(id)) {
        tracks.set(id, { id, where, key: `${t.key === "__rowid" ? "rowid" : t.key} ${row[t.key]}`, label: "", states: [], events: [], sentence: "", row });
        rowsAt.set(id, new Array(chain.length).fill(null));
        keyOf.set(id, { col: t.key, val: String(row[t.key]) });
      }
      rowsAt.get(id)![i] = row;
    }
  });
  // Rows whose key we know but that no longer match the query (e.g. email changed) still count as present.
  for (const [id, rows] of rowsAt) {
    const tr = tracks.get(id)!;
    const keyVal = keyOf.get(id)!.val;
    perWorld.forEach(({ tables }, i) => {
      if (rows[i]) return;
      const t = tables.find((x) => (x.table ? `${x.file} › ${x.table}` : x.file) === tr.where);
      const r = t?.rows.find((x) => String(x[t.key]) === keyVal);
      if (r) rows[i] = r;
    });
  }

  for (const [id, rows] of rowsAt) {
    const tr = tracks.get(id)!;
    const ref = rows.find(Boolean)!;
    tr.label = String(ref.name ?? ref.title ?? ref.email ?? Object.values(ref).find((v) => typeof v === "string" && v.length > 2) ?? "");
    rows.forEach((row, i) => {
      const c = chain[i];
      const prev = i > 0 ? rows[i - 1] : undefined;
      const state: TrackState = { world: c.world, step: c.step, present: !!row };
      if (i > 0) {
        if (row && !prev) {
          const seenBefore = rows.slice(0, i).some(Boolean);
          tr.events.push({ world: c.world, step: c.step, stepName: c.stepName, kind: seenBefore ? "reappeared" : "appeared", detail: seenBefore ? "came back" : "first appeared" });
        } else if (!row && prev) {
          tr.events.push({ world: c.world, step: c.step, stepName: c.stepName, kind: "vanished", detail: "deleted" });
        } else if (row && prev) {
          const changed = Object.keys(row)
            .filter((k) => norm(row[k]) !== norm(prev[k]) || (k in prev) !== (k in row))
            .map((k) => ({ column: k, before: prev[k] ?? null, after: row[k] ?? null }));
          if (changed.length) {
            state.changed = changed;
            const src = sources[i]?.[String(row.company ?? "")]?.source;
            const newSource = src && src !== sources[i - 1]?.[String(row.company ?? "")]?.source ? src : undefined;
            tr.events.push({
              world: c.world, step: c.step, stepName: c.stepName, kind: "changed",
              detail: changed.slice(0, 3).map((x) => `${x.column} ${show(x.before)} → ${show(x.after)}`).join(", "),
              source: newSource,
            });
          }
        }
      }
      tr.states.push(state);
    });
    const firstIdx = rows.findIndex(Boolean);
    const lastIdx = rows.length - 1 - [...rows].reverse().findIndex(Boolean);
    const name = `${tr.where} ${tr.key}${tr.label ? ` (${tr.label})` : ""}`;
    const vanish = tr.events.find((e) => e.kind === "vanished");
    if (vanish && !rows[rows.length - 1]) {
      tr.sentence = `${name} existed ${firstIdx === 0 ? "from base" : `from ${chain[firstIdx].world}`} through ${chain[lastIdx].world}, vanished at ${vanish.world} (${vanish.stepName}).`;
    } else if (firstIdx > 0) {
      tr.sentence = `${name} first appeared at ${chain[firstIdx].world} (${chain[firstIdx].stepName}).`;
    } else {
      const ch = tr.events.filter((e) => e.kind === "changed");
      tr.sentence = ch.length
        ? `${name} survives; changed at ${ch.map((e) => `${e.world} (${e.detail}${e.source ? `; source ${e.source}` : ""})`).join("; ")}.`
        : `${name} is unchanged across all ${chain.length} checkpoints.`;
    }
  }

  const list = [...tracks.values()].sort((a, b) => {
    const score = (t: Track) => (t.events.some((e) => e.kind === "vanished") ? 0 : t.events.length ? 1 : 2) * 10 + (t.where.endsWith(".csv") ? 0 : 1);
    return score(a) - score(b);
  });
  const shown = list.slice(0, 8);
  const sentence = shown[0]?.sentence ?? `No rows matching "${q}" in any checkpoint.`;
  return {
    query: q, agent, mode: "value", scanned: chain.length, ms: Math.round(performance.now() - t0), chain, tracks: shown, sentence,
    matchedRows: list.length,
  };
}
