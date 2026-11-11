export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function bytes(n?: number): string {
  if (n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function show(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v === "" ? '""' : v;
  if (typeof v === "number") return Number.isInteger(v) ? fmt(v) : v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return JSON.stringify(v);
}

/** Table cell rendering: blanks stay blank, id-like numbers get no thousands separators. */
export function cell(v: unknown, col: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (/(^|:)(price|salePrice)$/i.test(col) && v !== "" && !Number.isNaN(Number(v))) return `${Number(v).toLocaleString("en-US")} UZS`;
  if (typeof v === "number" && /(^|_)id$|rowid/i.test(col)) return String(v);
  return show(v);
}
