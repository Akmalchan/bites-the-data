import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "csv-stringify/sync";
import { parseCsv } from "../diff/csv.ts";
import type { Row } from "../diff/types.ts";
import type { WorldStore } from "../store/types.ts";

export interface ToolCall {
  tool: string;
  input: string;
  output: string;
  ms: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a step can do to its world. Every operation is logged as a tool call. */
export class StepContext {
  calls: ToolCall[] = [];
  constructor(
    private store: WorldStore,
    readonly worldId: string,
    private paceMs: number,
    private onCall?: (c: ToolCall) => void,
  ) {}

  async tool<T>(tool: string, input: string, fn: () => Promise<T>, describe?: (v: T) => string): Promise<T> {
    const t = performance.now();
    const v = await fn();
    const ms = Math.round((performance.now() - t) * 10) / 10;
    const call = { tool, input, output: describe ? describe(v) : "ok", ms };
    this.calls.push(call);
    this.onCall?.(call);
    if (this.paceMs) await sleep(this.paceMs);
    return v;
  }

  async raw(path: string): Promise<Buffer> {
    return this.store.reader(this.worldId).read(path);
  }

  readText(path: string) {
    return this.tool("read_file", path, async () => (await this.raw(path)).toString("utf8"), (s) => `${s.length.toLocaleString()} chars`);
  }

  readCsv(path: string) {
    return this.tool("read_file", path, async () => parseCsv((await this.raw(path)).toString("utf8")), (t) => `${t.rows.length.toLocaleString()} rows × ${t.columns.length} cols`);
  }

  writeCsv(path: string, columns: string[], rows: Row[], note?: string) {
    return this.tool("write_file", path, () => this.store.write(this.worldId, path, stringify(rows, { header: true, columns })), () => note ?? `${rows.length.toLocaleString()} rows`);
  }

  readJson<T = unknown>(path: string) {
    return this.tool("read_file", path, async () => JSON.parse((await this.raw(path)).toString("utf8")) as T, () => "parsed");
  }

  writeText(path: string, text: string, note?: string) {
    return this.tool("write_file", path, () => this.store.write(this.worldId, path, text), () => note ?? `${text.length.toLocaleString()} chars`);
  }

  writeJson(path: string, value: unknown, note?: string) {
    return this.writeText(path, JSON.stringify(value, null, 2) + "\n", note);
  }

  writeBinary(path: string, data: Buffer, note?: string) {
    return this.tool("write_file", path, () => this.store.write(this.worldId, path, data), () => note ?? `${data.length.toLocaleString()} bytes`);
  }

  remove(path: string) {
    return this.tool("run_bash", `rm ${path}`, () => this.store.remove(this.worldId, path), () => "removed");
  }

  rename(from: string, to: string) {
    return this.tool("run_bash", `mv ${from} ${to}`, async () => {
      const data = await this.raw(from);
      await this.store.write(this.worldId, to, data);
      await this.store.remove(this.worldId, from);
    }, () => "moved");
  }

  /** Open a SQLite file from the world, run `fn`, write it back. Shown as a sqlite3 call. */
  sqlite<T>(path: string, sql: string, fn: (db: DatabaseSync) => T, describe?: (v: T) => string): Promise<T> {
    return this.tool(
      "run_bash",
      `sqlite3 ${path} "${sql}"`,
      async () => {
        const dir = mkdtempSync(join(tmpdir(), "delta-step-"));
        const p = join(dir, "db.sqlite");
        try {
          writeFileSync(p, await this.raw(path));
          const db = new DatabaseSync(p);
          let v: T;
          try {
            v = fn(db);
          } finally {
            db.close();
          }
          await this.store.write(this.worldId, path, readFileSync(p));
          return v;
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      describe,
    );
  }

  /** A pure-compute step (the agent "thinking with code"), logged as a python call. */
  compute<T>(input: string, fn: () => T, describe?: (v: T) => string): Promise<T> {
    return this.tool("run_python", input, async () => fn(), describe);
  }
}
