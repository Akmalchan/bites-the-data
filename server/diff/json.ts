import type { JsonChange, JsonDiff } from "./types.ts";

const CAP = 2000;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function seg(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

/** Arrays of objects that all carry a unique `id` are matched by id, not position. */
function idKeyed(arr: unknown[]): Map<string, unknown> | null {
  if (arr.length === 0 || !arr.every((x) => isObj(x) && ("id" in x))) return null;
  const m = new Map<string, unknown>();
  for (const x of arr as Record<string, unknown>[]) {
    const k = String(x.id);
    if (m.has(k)) return null;
    m.set(k, x);
  }
  return m;
}

export function jsonPathDiff(before: unknown, after: unknown): JsonChange[] {
  const out: JsonChange[] = [];
  walk(before, after, "", out);
  return out;
}

function walk(a: unknown, b: unknown, path: string, out: JsonChange[]): void {
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) {
      const p = path + seg(k);
      if (!(k in b)) out.push({ path: p, kind: "removed", before: a[k] });
      else walk(a[k], b[k], p, out);
    }
    for (const k of Object.keys(b)) if (!(k in a)) out.push({ path: path + seg(k), kind: "added", after: b[k] });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ma = idKeyed(a);
    const mb = idKeyed(b);
    if (ma && mb) {
      for (const [k, v] of ma) {
        const p = `${path}[id=${k}]`;
        if (!mb.has(k)) out.push({ path: p, kind: "removed", before: v });
        else walk(v, mb.get(k), p, out);
      }
      for (const [k, v] of mb) if (!ma.has(k)) out.push({ path: `${path}[id=${k}]`, kind: "added", after: v });
      return;
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const p = `${path}[${i}]`;
      if (i >= a.length) out.push({ path: p, kind: "added", after: b[i] });
      else if (i >= b.length) out.push({ path: p, kind: "removed", before: a[i] });
      else walk(a[i], b[i], p, out);
    }
    return;
  }
  if (a === b) return;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return;
  out.push({ path: path || "$", kind: "changed", before: a, after: b });
}

export function diffJson(before: string, after: string): JsonDiff {
  let a: unknown;
  let b: unknown;
  try {
    a = before === "" ? undefined : JSON.parse(before);
    b = after === "" ? undefined : JSON.parse(after);
  } catch (e) {
    return { type: "json", changes: [], total: 0, truncated: false, parseError: (e as Error).message };
  }
  const all = jsonPathDiff(a, b).map((c) => ({ ...c, path: c.path.startsWith(".") ? c.path.slice(1) : c.path }));
  return { type: "json", changes: all.slice(0, CAP), total: all.length, truncated: all.length > CAP };
}
