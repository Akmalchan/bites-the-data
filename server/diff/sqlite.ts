import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { diffTables } from "./table.ts";
import type { Cell, Row, SqliteDiff, TableDiff } from "./types.ts";

interface TableInfo {
  name: string;
  sql: string;
  columns: string[];
  pk: string[];
  withoutRowid: boolean;
}

function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Uint8Array) {
    return `<blob ${v.byteLength} B ${createHash("sha256").update(v).digest("hex").slice(0, 8)}>`;
  }
  return String(v);
}

function quote(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function tables(db: DatabaseSync): TableInfo[] {
  const rows = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string; sql: string }[];
  return rows.map(({ name, sql }) => {
    const info = db.prepare(`PRAGMA table_info(${quote(name)})`).all() as { name: string; pk: number }[];
    const pk = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    return { name, sql: sql ?? "", columns: info.map((c) => c.name), pk, withoutRowid: /WITHOUT\s+ROWID/i.test(sql ?? "") };
  });
}

function readTable(db: DatabaseSync, t: TableInfo, useRowid: boolean): { columns: string[]; rows: Row[] } {
  const select = useRowid ? `SELECT rowid AS "__rowid", * FROM ${quote(t.name)}` : `SELECT * FROM ${quote(t.name)}`;
  const raw = db.prepare(select).all() as Record<string, unknown>[];
  const rows: Row[] = raw.map((r) => {
    const o: Row = {};
    for (const k of Object.keys(r)) o[k] = toCell(r[k]);
    return o;
  });
  return { columns: t.columns, rows };
}

export function sqliteCounts(path: string): Record<string, number> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const out: Record<string, number> = {};
    for (const t of tables(db)) {
      out[t.name] = (db.prepare(`SELECT count(*) AS n FROM ${quote(t.name)}`).get() as { n: number }).n;
    }
    return out;
  } finally {
    db.close();
  }
}

export function sqliteScalar(path: string, query: string): number | string | null {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare(query).get() as Record<string, unknown> | undefined;
    if (!row) return null;
    const v = Object.values(row)[0];
    return typeof v === "bigint" ? Number(v) : (v as number | string | null);
  } finally {
    db.close();
  }
}

/** Row-level diff of two SQLite files. Either path may be null (file added/removed). */
export function diffSqlite(beforePath: string | null, afterPath: string | null): SqliteDiff {
  const dbA = beforePath ? new DatabaseSync(beforePath, { readOnly: true }) : null;
  const dbB = afterPath ? new DatabaseSync(afterPath, { readOnly: true }) : null;
  try {
    const ta = dbA ? tables(dbA) : [];
    const tb = dbB ? tables(dbB) : [];
    const names = [...new Set([...tb.map((t) => t.name), ...ta.map((t) => t.name)])];
    const out: SqliteDiff = {
      type: "sqlite",
      tables: [],
      tablesAdded: tb.filter((t) => !ta.some((x) => x.name === t.name)).map((t) => t.name),
      tablesRemoved: ta.filter((t) => !tb.some((x) => x.name === t.name)).map((t) => t.name),
      bytesOnlyChange: false,
    };
    for (const name of names) {
      const a = ta.find((t) => t.name === name);
      const b = tb.find((t) => t.name === name);
      const ref = (b ?? a)!;
      // Declared PK when both sides agree on it, else rowid (stable unless VACUUM renumbers).
      const pkA = a?.pk ?? [];
      const pkB = b?.pk ?? [];
      const declared = pkB.length > 0 && (!a || pkA.join() === pkB.join()) ? pkB : [];
      const useRowid = declared.length === 0 && !ref.withoutRowid;
      const empty = { columns: ref.columns, rows: [] as Row[] };
      const rowsA = a && dbA ? readTable(dbA, a, useRowid) : empty;
      const rowsB = b && dbB ? readTable(dbB, b, useRowid) : empty;
      if (useRowid) {
        rowsA.columns = ["__rowid", ...rowsA.columns];
        rowsB.columns = ["__rowid", ...rowsB.columns];
      }
      const td: TableDiff = diffTables(rowsA, rowsB, {
        name,
        key: declared.length ? declared : useRowid ? ["__rowid"] : undefined,
        keySource: declared.length ? "declared" : useRowid ? "rowid" : undefined,
      });
      td.status = !a ? "added" : !b ? "removed" : td.addedCount + td.removedCount + td.changedCount + td.columnsAdded.length + td.columnsRemoved.length > 0 || a.sql !== b.sql ? "modified" : "unchanged";
      td.schemaBefore = a?.sql;
      td.schemaAfter = b?.sql;
      out.tables.push(td);
    }
    out.bytesOnlyChange = !!dbA && !!dbB && out.tables.every((t) => t.status === "unchanged");
    return out;
  } finally {
    dbA?.close();
    dbB?.close();
  }
}
