import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { diffCsv } from "../server/diff/csv.ts";
import { diffJson } from "../server/diff/json.ts";
import { diffSqlite } from "../server/diff/sqlite.ts";
import { diffText } from "../server/diff/text.ts";
import { diffWorlds, type WorldReader } from "../server/diff/engine.ts";
import type { CsvDiff, Manifest, SqliteDiff, BinaryDiff } from "../server/diff/types.ts";
import { evaluateInvariant } from "../server/invariant.ts";
import { toE164, editDistanceAtMost1 } from "../server/agents/scripted.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "delta-test-"));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function memWorld(files: Record<string, string | Buffer>): WorldReader {
  const bufs = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.isBuffer(v) ? v : Buffer.from(v)]));
  const m: Manifest = {};
  for (const [k, b] of Object.entries(bufs)) m[k] = { path: k, size: b.length, hash: sha(b) };
  return { manifest: async () => m, read: async (p) => bufs[p] };
}

describe("CSV keyed diff", () => {
  const before = "id,name,email,amount\n1,Ann,ann@x.io,100\n2,Bob,bob@x.io,200\n3,Cy,cy@x.io,300\n4,Bob,BOB@x.io,200\n";
  it("detects the id key and reports added/removed/changed rows with per-cell changes", () => {
    const after = "id,name,email,amount\n3,Cy,cy@x.io,30000\n1,Ann,ann@y.io,100\n5,Eve,eve@x.io,50\n2,Bob,bob@x.io,200\n";
    const d = diffCsv("t.csv", before, after).table;
    expect(d.key).toEqual(["id"]);
    expect(d.keySource).toBe("detected");
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(1);
    expect(d.changedCount).toBe(2);
    expect(d.changed.find((c) => c.key === "1")!.cells.email).toEqual({ before: "ann@x.io", after: "ann@y.io" });
    expect(d.magnitude).toEqual([{ column: "amount", count: 1, medianFactor: 100 }]);
  });
  it("tells merged duplicates from lost rows via a surviving natural key", () => {
    const after = "id,name,email,amount\n1,Ann,ann@x.io,100\n2,Bob,bob@x.io,200\n";
    const d = diffCsv("t.csv", before, after).table;
    expect(d.removedCount).toBe(2);
    expect(d.twins).toMatchObject({ column: "email", matched: 1, unmatched: 1, unmatchedKeys: ["3"] });
  });
  it("is order-insensitive (a full re-sort is zero changes)", () => {
    const lines = before.trim().split("\n");
    const resorted = [lines[0], ...lines.slice(1).reverse()].join("\n") + "\n";
    const d = diffCsv("t.csv", before, resorted).table;
    expect(d.addedCount + d.removedCount + d.changedCount).toBe(0);
  });
  it("reports added and removed columns without counting them as cell changes", () => {
    const after = "id,name,region,email,amount\n1,Ann,EMEA,ann@x.io,100\n2,Bob,AMER,bob@x.io,200\n3,Cy,APAC,cy@x.io,300\n4,Bob,AMER,BOB@x.io,200\n";
    const d = diffCsv("t.csv", before, after).table;
    expect(d.columnsAdded).toEqual(["region"]);
    expect(d.cellsChanged).toBe(0);
  });
  it("falls back to row hashes when there is no unique key", () => {
    const a = "name,city\nAnn,SF\nAnn,SF\nBob,LA\n";
    const b = "name,city\nAnn,SF\nBob,LA\nCy,NY\n";
    const d = diffCsv("t.csv", a, b).table;
    expect(d.keySource).toBe("rowhash");
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(1);
  });
  it("counts filled empty cells", () => {
    const d = diffCsv("t.csv", "id,country\n1,\n2,US\n", "id,country\n1,GB\n2,US\n").table;
    expect(d.cellsFilled).toBe(1);
  });
});

describe("SQLite diff", () => {
  function db(rows: [number, string, number][], extra?: string): string {
    const p = join(tmp(), "x.sqlite");
    const d = new DatabaseSync(p);
    d.exec("CREATE TABLE deals (id INTEGER PRIMARY KEY, title TEXT, amount REAL); CREATE TABLE log (msg TEXT);");
    const ins = d.prepare("INSERT INTO deals VALUES (?,?,?)");
    for (const r of rows) ins.run(...r);
    d.exec("INSERT INTO log VALUES ('a'), ('b')");
    if (extra) d.exec(extra);
    d.close();
    return p;
  }
  it("diffs rows per table by primary key and flags magnitude shifts", () => {
    const a = db([[1, "A", 60000], [2, "B", 10], [3, "C", 5]]);
    const b = db([[1, "A", 600], [2, "B2", 10], [4, "D", 7]], "ALTER TABLE deals ADD COLUMN owner TEXT");
    const d: SqliteDiff = diffSqlite(a, b);
    const deals = d.tables.find((t) => t.name === "deals")!;
    expect(deals.keySource).toBe("declared");
    expect(deals.addedCount).toBe(1);
    expect(deals.removedCount).toBe(1);
    expect(deals.changedCount).toBe(2);
    expect(deals.columnsAdded).toEqual(["owner"]);
    expect(deals.magnitude[0]).toMatchObject({ column: "amount", count: 1 });
    expect(d.tables.find((t) => t.name === "log")!.status).toBe("unchanged");
  });
  it("uses rowid for tables without a primary key, and spots byte-only changes", () => {
    const a = db([[1, "A", 1]]);
    const copy = join(tmp(), "y.sqlite");
    writeFileSync(copy, readFileSync(a));
    const d = new DatabaseSync(copy);
    d.exec("VACUUM");
    d.close();
    const r = diffSqlite(a, copy);
    expect(r.tables.find((t) => t.name === "log")!.keySource).toBe("rowid");
    expect(r.bytesOnlyChange).toBe(true);
  });
});

describe("JSON path diff", () => {
  it("emits dotted paths and matches arrays of objects by id", () => {
    const a = JSON.stringify({ v: 3, dedupe: { strategy: "exact" }, sources: [{ id: "x", on: false }, { id: "y", on: true }], tags: ["a"] });
    const b = JSON.stringify({ v: 4, dedupe: { strategy: "fuzzy" }, sources: [{ id: "y", on: true }, { id: "x", on: true }], tags: ["a", "b"], extra: 1 });
    const d = diffJson(a, b);
    const paths = d.changes.map((c) => `${c.kind}:${c.path}`).sort();
    expect(paths).toEqual(["added:extra", "added:tags[1]", "changed:dedupe.strategy", "changed:sources[id=x].on", "changed:v"]);
  });
  it("reports invalid JSON instead of throwing", () => {
    expect(diffJson("{", "{}").parseError).toBeTruthy();
  });
});

describe("text diff", () => {
  it("counts added and removed lines", () => {
    const d = diffText("a.md", "a\nb\nc\n", "a\nB\nc\nd\n");
    expect(d.linesAdded).toBe(2);
    expect(d.linesRemoved).toBe(1);
  });
});

describe("whole-world diff", () => {
  it("finds added, removed, modified and renamed files", async () => {
    const a = memWorld({ "keep.txt": "same", "old/name.md": "moved content", "gone.csv": "id\n1\n", "data.csv": "id,v\n1,a\n" });
    const b = memWorld({ "keep.txt": "same", "new/name.md": "moved content", "data.csv": "id,v\n1,b\n", "fresh.json": "{}" });
    const r = await diffWorlds(a, b);
    const by = Object.fromEntries(r.summary.files.map((f) => [f.path, f]));
    expect(by["new/name.md"]).toMatchObject({ status: "renamed", oldPath: "old/name.md" });
    expect(by["gone.csv"].status).toBe("removed");
    expect(by["fresh.json"].status).toBe("added");
    expect(by["data.csv"]).toMatchObject({ status: "modified", kind: "csv" });
    expect((r.details.get("data.csv") as CsvDiff).table.cellsChanged).toBe(1);
    expect(r.summary.unchanged).toBe(1);
  });
  it("compares a large binary file by size and hash, quickly", async () => {
    const big = Buffer.alloc(24 * 1024 * 1024, 7);
    const big2 = Buffer.concat([big, Buffer.from([1, 2, 3])]);
    const t = performance.now();
    const r = await diffWorlds(memWorld({ "blob.bin": big }), memWorld({ "blob.bin": big2 }));
    const d = r.details.get("blob.bin") as BinaryDiff;
    expect(d.type).toBe("binary");
    expect(d.sizeAfter! - d.sizeBefore!).toBe(3);
    expect(performance.now() - t).toBeLessThan(2000);
  });
  it("diffs a 200k-row CSV in reasonable time", async () => {
    const rows = (f: (i: number) => string) => "id,email,amount\n" + Array.from({ length: 200_000 }, (_, i) => f(i)).join("\n") + "\n";
    const a = rows((i) => `${i},u${i}@x.io,${i}`);
    const b = rows((i) => (i % 1000 === 0 ? `${i},u${i}@y.io,${i}` : `${i},u${i}@x.io,${i}`));
    const t = performance.now();
    const r = await diffWorlds(memWorld({ "big.csv": a }), memWorld({ "big.csv": b }));
    expect(r.summary.files[0].stats.rowsChanged).toBe(200);
    expect(performance.now() - t).toBeLessThan(8000);
  });
});

describe("invariants and helpers", () => {
  it("evaluates rows() and exists()", async () => {
    const w = memWorld({ "c.csv": "id\n1\n2\n3\n" });
    expect((await evaluateInvariant("rows(c.csv) >= 3", w)).ok).toBe(true);
    expect((await evaluateInvariant("rows(c.csv) >= 3 and exists(nope.txt) == 1", w)).ok).toBe(false);
    expect((await evaluateInvariant("bogus", w)).error).toBeTruthy();
  });
  it("normalizes phones and measures edit distance", () => {
    expect(toE164("(415) 555-0134")).toBe("+14155550134");
    expect(toE164("0044 20 7946 0958")).toBe("+442079460958");
    expect(editDistanceAtMost1("maria", "mario")).toBe(true);
    expect(editDistanceAtMost1("daniel", "daniela")).toBe(true);
    expect(editDistanceAtMost1("chris", "kris")).toBe(false);
  });
});
