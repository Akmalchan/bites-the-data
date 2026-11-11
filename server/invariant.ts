// Tiny invariant language evaluated against one world:
//   rows(customers.csv) >= 4913
//   sql(crm.sqlite, "select round(sum(amount)) from deals") >= 123456
//   exists(config.json) == 1
//   size(cache/embeddings.bin) < 1000000
// Several clauses can be joined with "and".
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseCsv } from "./diff/csv.ts";
import { sqliteScalar } from "./diff/sqlite.ts";
import type { WorldReader } from "./diff/engine.ts";
import { baseline } from "./geargo.ts";

export interface InvariantResult {
  ok: boolean;
  value: string; // human-readable observed value(s)
  error?: string;
}

const CLAUSE = /^\s*(rows|sql|exists|size|drift|unfit|zeroed)\(\s*([^,)]+?)\s*(?:,\s*"((?:[^"\\]|\\.)*)"\s*)?\)\s*(>=|<=|==|!=|>|<)\s*(-?[\d.,_]+)\s*$/i;

export function parseInvariant(src: string) {
  const parts = src.split(/\s+and\s+/i);
  return parts.map((p) => {
    const m = p.match(CLAUSE);
    if (!m) throw new Error(`cannot parse "${p.trim()}". Try: rows(customers.csv) >= 4900`);
    return { fn: m[1].toLowerCase(), path: m[2].trim(), query: m[3]?.replace(/\\"/g, '"'), op: m[4], rhs: Number(m[5].replace(/[,_]/g, "")) };
  });
}

function cmp(a: number, op: string, b: number): boolean {
  switch (op) {
    case ">=": return a >= b;
    case "<=": return a <= b;
    case ">": return a > b;
    case "<": return a < b;
    case "==": return a === b;
    default: return a !== b;
  }
}

export async function evaluateInvariant(src: string, reader: WorldReader): Promise<InvariantResult> {
  let clauses;
  try {
    clauses = parseInvariant(src);
  } catch (e) {
    return { ok: false, value: "", error: (e as Error).message };
  }
  const manifest = await reader.manifest();
  const seen: string[] = [];
  let ok = true;
  for (const c of clauses) {
    let v: number;
    const entry = manifest[c.path];
    if (c.fn === "exists") v = entry ? 1 : 0;
    else if (!entry) {
      v = 0;
    } else if (c.fn === "size") v = entry.size;
    else if (c.fn === "rows") v = parseCsv((await reader.read(c.path)).toString("utf8")).rows.length;
    else if (c.fn === "drift" || c.fn === "unfit" || c.fn === "zeroed") {
      // catalog rules, measured against the base catalog (by SKU)
      const rows = parseCsv((await reader.read(c.path)).toString("utf8")).rows;
      if (c.fn === "drift") {
        v = 0;
        for (const r of rows) {
          const b = baseline.get(String(r.sku));
          if (b && Number(b.price)) v = Math.max(v, Math.abs(Number(r.price) / Number(b.price) - 1));
        }
        v = Math.round(v * 1000) / 1000;
      } else if (c.fn === "unfit") {
        v = rows.filter((r) => String(r["product:compatibleVehicleSlugs"] ?? "").trim() === "" && String(r["product:isUniversalFit"]) !== "true").length;
      } else {
        v = rows.filter((r) => String(r.stockOnHand) === "0" && Number(baseline.get(String(r.sku))?.stockOnHand ?? 0) > 0).length;
      }
    }
    else {
      const local = reader.localPath?.(c.path);
      let p = local ?? "";
      if (!local) {
        const dir = join(tmpdir(), "delta-sqlite-cache");
        mkdirSync(dir, { recursive: true });
        p = join(dir, `${entry.hash}.sqlite`);
        if (!existsSync(p)) writeFileSync(p, await reader.read(c.path));
      }
      try {
        v = Number(sqliteScalar(p, c.query ?? "select 0"));
      } catch (e) {
        return { ok: false, value: "", error: `sql error: ${(e as Error).message}` };
      }
    }
    seen.push(`${c.fn === "sql" ? "sql" : `${c.fn}(${c.path})`} = ${v.toLocaleString("en-US")}`);
    if (!cmp(v, c.op, c.rhs)) ok = false;
  }
  return { ok, value: seen.join(", ") };
}

export function invariantId(src: string): string {
  return createHash("sha1").update(src).digest("hex").slice(0, 8);
}
