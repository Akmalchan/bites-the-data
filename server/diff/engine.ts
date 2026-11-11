// Whole-world diff: manifest comparison, rename detection, then a typed diff
// per changed file (CSV rows, SQLite rows, JSON paths, text lines, binary hash).
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, basename } from "node:path";
import { diffCsv } from "./csv.ts";
import { diffJson } from "./json.ts";
import { diffSqlite } from "./sqlite.ts";
import { diffText } from "./text.ts";
import type {
  FileChange,
  FileDetail,
  FileKind,
  Flag,
  Manifest,
  ManifestEntry,
  TableDiff,
  WorldDiff,
} from "./types.ts";

/** Anything Delta can read a world through: local dir, Archil disk, a test fixture. */
export interface WorldReader {
  manifest(): Promise<Manifest>;
  read(path: string): Promise<Buffer>;
  /** If the file already exists on local disk, its absolute path (lets SQLite open it in place). */
  localPath?(path: string): string | null;
}

/** Files bigger than this are compared by size + hash only. */
export const STRUCTURED_LIMIT = 64 * 1024 * 1024;

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");

export function kindFor(path: string, sample?: Buffer): FileKind {
  const ext = extname(path).toLowerCase();
  if (ext === ".csv" || ext === ".tsv") return "csv";
  if ([".db", ".sqlite", ".sqlite3"].includes(ext)) return "sqlite";
  if (sample && sample.subarray(0, 16).equals(SQLITE_MAGIC)) return "sqlite";
  if (ext === ".json") return "json";
  if ([".png", ".jpg", ".jpeg", ".gif", ".bin", ".parquet", ".zip", ".gz", ".pdf", ".pkl", ".npy"].includes(ext)) return "binary";
  if (sample) {
    const head = sample.subarray(0, 8192);
    if (head.includes(0)) return "binary";
  }
  return "text";
}

const tmpRoot = join(tmpdir(), "delta-sqlite-cache");

/** Materialize a buffer as a file so SQLite can open it. Content-addressed, so reused across diffs. */
async function sqlitePath(reader: WorldReader, entry: ManifestEntry): Promise<string> {
  const local = reader.localPath?.(entry.path);
  if (local) return local;
  mkdirSync(tmpRoot, { recursive: true });
  const p = join(tmpRoot, `${entry.hash}.sqlite`);
  if (!existsSync(p)) writeFileSync(p, await reader.read(entry.path));
  return p;
}

export interface WorldDiffResult {
  summary: WorldDiff;
  details: Map<string, FileDetail>;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function nounFor(name: string): string {
  return basename(name).replace(/\.(csv|tsv)$/i, "");
}

export function tableFlags(t: TableDiff, where: string): Flag[] {
  const flags: Flag[] = [];
  const noun = nounFor(t.name);
  if (t.removedCount > 0) {
    if (t.twins && t.twins.unmatched > 0) {
      flags.push({
        level: "warn",
        text: `${where}: ${fmt(t.twins.unmatched)} rows deleted with no surviving ${t.twins.column} match` +
          (t.twins.matched ? ` (${fmt(t.twins.matched)} more were merged duplicates)` : ""),
      });
    } else if (t.twins && t.twins.matched > 0) {
      flags.push({ level: "info", text: `${where}: ${fmt(t.twins.matched)} duplicate rows merged (every ${t.twins.column} still present)` });
    } else {
      flags.push({ level: "warn", text: `${where}: ${fmt(t.removedCount)} rows deleted` });
    }
  }
  for (const m of t.magnitude) {
    const factor = m.medianFactor >= 1 ? `×${round(m.medianFactor)}` : `÷${round(1 / m.medianFactor)}`;
    flags.push({ level: "warn", text: `${where}: ${fmt(m.count)} ${m.column} values changed by ≥10x (median ${factor})` });
  }
  if (t.columnsRemoved.length) flags.push({ level: "warn", text: `${where}: column${t.columnsRemoved.length > 1 ? "s" : ""} dropped: ${t.columnsRemoved.join(", ")}` });
  if (t.columnsAdded.length) flags.push({ level: "info", text: `${where}: column${t.columnsAdded.length > 1 ? "s" : ""} added: ${t.columnsAdded.join(", ")}` });
  return flags;
}

function round(x: number): string {
  return x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
}

export function tableSummary(t: TableDiff): string {
  const parts: string[] = [];
  if (t.removedCount) parts.push(`−${fmt(t.removedCount)} rows`);
  if (t.addedCount) parts.push(`+${fmt(t.addedCount)} rows`);
  if (t.changedCount) parts.push(`${fmt(t.cellsChanged)} cells in ${fmt(t.changedCount)} rows`);
  if (t.columnsAdded.length) parts.push(`+${t.columnsAdded.length} col`);
  if (t.columnsRemoved.length) parts.push(`−${t.columnsRemoved.length} col`);
  return parts.join(" · ") || "no row changes";
}

async function detailFor(
  kind: FileKind,
  path: string,
  a: WorldReader,
  b: WorldReader,
  ea: ManifestEntry | undefined,
  eb: ManifestEntry | undefined,
): Promise<FileDetail> {
  const tooBig = (ea?.size ?? 0) > STRUCTURED_LIMIT || (eb?.size ?? 0) > STRUCTURED_LIMIT;
  if (kind === "binary" || tooBig) {
    return {
      type: "binary",
      sizeBefore: ea?.size,
      sizeAfter: eb?.size,
      hashBefore: ea?.hash,
      hashAfter: eb?.hash,
      note: tooBig ? `Over ${STRUCTURED_LIMIT / 1024 / 1024} MB: compared by size and SHA-256 only` : undefined,
    };
  }
  if (kind === "sqlite") {
    const pa = ea ? await sqlitePath(a, ea) : null;
    const pb = eb ? await sqlitePath(b, eb) : null;
    return diffSqlite(pa, pb);
  }
  const ta = ea ? (await a.read(ea.path)).toString("utf8") : "";
  const tb = eb ? (await b.read(eb.path)).toString("utf8") : "";
  if (kind === "csv") return diffCsv(path, ta, tb);
  if (kind === "json") return diffJson(ta, tb);
  return diffText(path, ta, tb);
}

function describe(fc: FileChange, d: FileDetail): void {
  const where = fc.path;
  switch (d.type) {
    case "csv": {
      const t = d.table;
      fc.stats = {
        rowsAdded: t.addedCount,
        rowsRemoved: t.removedCount,
        rowsChanged: t.changedCount,
        cellsChanged: t.cellsChanged,
        columnsAdded: t.columnsAdded.length,
        columnsRemoved: t.columnsRemoved.length,
        rowsLost: t.twins ? t.twins.unmatched : t.removedCount,
        rowsBefore: t.rowsBefore,
        rowsAfter: t.rowsAfter,
        cellsFilled: t.cellsFilled,
        magnitudeShifts: t.magnitude.reduce((s, m) => s + m.count, 0),
      };
      if (fc.status === "modified") fc.flags.push(...tableFlags(t, where));
      fc.summary = fc.status === "modified" ? tableSummary(t) : `${fmt(fc.status === "added" ? t.rowsAfter : t.rowsBefore)} rows`;
      break;
    }
    case "sqlite": {
      let rowsAdded = 0, rowsRemoved = 0, rowsChanged = 0, cellsChanged = 0, columnsAdded = 0, columnsRemoved = 0, tablesChanged = 0;
      let rowsLost = 0, cellsFilled = 0, magnitudeShifts = 0;
      const parts: string[] = [];
      for (const t of d.tables) {
        rowsAdded += t.addedCount;
        rowsRemoved += t.removedCount;
        rowsChanged += t.changedCount;
        cellsChanged += t.cellsChanged;
        columnsAdded += t.columnsAdded.length;
        columnsRemoved += t.columnsRemoved.length;
        rowsLost += t.twins ? t.twins.unmatched : t.removedCount;
        cellsFilled += t.cellsFilled;
        magnitudeShifts += t.magnitude.reduce((s, m) => s + m.count, 0);
        if (t.status !== "unchanged") {
          tablesChanged++;
          if (fc.status === "modified") {
            parts.push(`${t.name}: ${t.status === "modified" ? tableSummary(t) : t.status}`);
            fc.flags.push(...tableFlags(t, `${where} › ${t.name}`));
          }
        }
      }
      for (const t of d.tablesRemoved) fc.flags.push({ level: "warn", text: `${where}: table ${t} dropped` });
      if (d.bytesOnlyChange) fc.flags.push({ level: "info", text: `${where}: bytes changed but every row is identical (page layout only)` });
      fc.stats = { rowsAdded, rowsRemoved, rowsChanged, cellsChanged, columnsAdded, columnsRemoved, tablesChanged, rowsLost, cellsFilled, magnitudeShifts };
      fc.summary =
        fc.status === "modified"
          ? parts.join("; ") || "no row changes"
          : `${d.tables.length} table${d.tables.length === 1 ? "" : "s"}`;
      break;
    }
    case "json": {
      fc.stats = { pathsChanged: d.total };
      if (d.parseError) fc.summary = `invalid JSON: ${d.parseError}`;
      else if (fc.status === "modified") {
        fc.summary = `${fmt(d.total)} path${d.total === 1 ? "" : "s"} changed`;
        const first = d.changes.slice(0, 2).map((c) => c.path).join(", ");
        if (first) fc.flags.push({ level: "info", text: `${where}: ${first}${d.total > 2 ? ", …" : ""}` });
      } else fc.summary = fc.status;
      break;
    }
    case "text": {
      fc.stats = { linesAdded: d.linesAdded, linesRemoved: d.linesRemoved };
      fc.summary = `+${fmt(d.linesAdded)} −${fmt(d.linesRemoved)} lines`;
      break;
    }
    case "binary": {
      const s = (n?: number) => (n === undefined ? "—" : humanBytes(n));
      fc.summary = fc.status === "modified" ? `${s(d.sizeBefore)} → ${s(d.sizeAfter)}` : s(d.sizeAfter ?? d.sizeBefore);
      break;
    }
  }
  if (fc.status === "removed" && fc.kind !== "text" && fc.kind !== "binary") {
    fc.flags.push({ level: "warn", text: `${where}: data file deleted` });
  }
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export async function diffWorlds(a: WorldReader, b: WorldReader, labels = { from: "a", to: "b" }): Promise<WorldDiffResult> {
  const t0 = performance.now();
  const [ma, mb] = await Promise.all([a.manifest(), b.manifest()]);
  const removed: ManifestEntry[] = [];
  const added: ManifestEntry[] = [];
  const modified: [ManifestEntry, ManifestEntry][] = [];
  let unchanged = 0;
  for (const p of Object.keys(ma)) {
    const eb = mb[p];
    if (!eb) removed.push(ma[p]);
    else if (eb.hash !== ma[p].hash) modified.push([ma[p], eb]);
    else unchanged++;
  }
  for (const p of Object.keys(mb)) if (!ma[p]) added.push(mb[p]);

  // Renames: a removed path and an added path with identical content.
  const renames: [ManifestEntry, ManifestEntry][] = [];
  const addedByHash = new Map<string, ManifestEntry[]>();
  for (const e of added) addedByHash.set(e.hash, [...(addedByHash.get(e.hash) ?? []), e]);
  for (let i = removed.length - 1; i >= 0; i--) {
    const cands = addedByHash.get(removed[i].hash);
    if (cands && cands.length) {
      const to = cands.shift()!;
      renames.push([removed[i], to]);
      removed.splice(i, 1);
      added.splice(added.indexOf(to), 1);
    }
  }

  const details = new Map<string, FileDetail>();
  const files: FileChange[] = [];

  const sampleOf = async (r: WorldReader, e: ManifestEntry) => {
    const ext = extname(e.path).toLowerCase();
    if ([".csv", ".tsv", ".json", ".db", ".sqlite", ".sqlite3"].includes(ext)) return undefined;
    if (e.size > STRUCTURED_LIMIT) return Buffer.alloc(1); // force binary
    return (await r.read(e.path)).subarray(0, 8192);
  };

  const jobs: Promise<void>[] = [];
  const push = (fc: FileChange, ea: ManifestEntry | undefined, eb: ManifestEntry | undefined) => {
    files.push(fc);
    jobs.push(
      (async () => {
        const sample = eb ? await sampleOf(b, eb) : ea ? await sampleOf(a, ea) : undefined;
        if (sample && sample.length === 1 && sample[0] === 0 && (ea?.size ?? eb?.size ?? 0) > STRUCTURED_LIMIT) fc.kind = "binary";
        else fc.kind = kindFor(fc.path, sample);
        const d = await detailFor(fc.kind, fc.path, a, b, ea, eb);
        details.set(fc.path, d);
        describe(fc, d);
      })(),
    );
  };

  for (const [ea, eb] of modified)
    push({ path: ea.path, status: "modified", kind: "text", sizeBefore: ea.size, sizeAfter: eb.size, hashBefore: ea.hash, hashAfter: eb.hash, stats: {}, flags: [], summary: "" }, ea, eb);
  for (const eb of added)
    push({ path: eb.path, status: "added", kind: "text", sizeAfter: eb.size, hashAfter: eb.hash, stats: {}, flags: [], summary: "" }, undefined, eb);
  for (const ea of removed)
    push({ path: ea.path, status: "removed", kind: "text", sizeBefore: ea.size, hashBefore: ea.hash, stats: {}, flags: [], summary: "" }, ea, undefined);
  for (const [ea, eb] of renames) {
    files.push({
      path: eb.path,
      oldPath: ea.path,
      status: "renamed",
      kind: kindFor(eb.path),
      sizeBefore: ea.size,
      sizeAfter: eb.size,
      hashBefore: ea.hash,
      hashAfter: eb.hash,
      stats: {},
      flags: [],
      summary: `renamed from ${ea.path} (content identical)`,
    });
  }
  await Promise.all(jobs);

  const order = { modified: 0, removed: 1, added: 2, renamed: 3 } as const;
  files.sort((x, y) => {
    const wx = x.flags.some((f) => f.level === "warn") ? 0 : 1;
    const wy = y.flags.some((f) => f.level === "warn") ? 0 : 1;
    return wx - wy || order[x.status] - order[y.status] || x.path.localeCompare(y.path);
  });

  const totals = {
    filesAdded: added.length,
    filesRemoved: removed.length,
    filesModified: modified.length,
    filesRenamed: renames.length,
    rowsAdded: 0,
    rowsRemoved: 0,
    rowsChanged: 0,
    cellsChanged: 0,
    columnsAdded: 0,
  };
  for (const f of files) {
    if (f.status !== "modified") continue;
    totals.rowsAdded += f.stats.rowsAdded ?? 0;
    totals.rowsRemoved += f.stats.rowsRemoved ?? 0;
    totals.rowsChanged += f.stats.rowsChanged ?? 0;
    totals.cellsChanged += f.stats.cellsChanged ?? 0;
    totals.columnsAdded += f.stats.columnsAdded ?? 0;
  }
  const highlights = files.flatMap((f) => f.flags).sort((x, y) => (x.level === y.level ? 0 : x.level === "warn" ? -1 : 1));

  return {
    summary: { from: labels.from, to: labels.to, files, unchanged, totals, highlights, ms: Math.round(performance.now() - t0) },
    details,
  };
}
