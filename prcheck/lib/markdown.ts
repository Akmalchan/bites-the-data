// The PR comment, written to read like a native GitHub bot. Only emoji: status dots.
import type { CsvReport, FileReport, JsonReport, RuleHit } from "./analyze.ts";
import type { Report } from "./report.ts";

const RED = "🔴";
const YELLOW = "🟡";
const GREEN = "🟢";

const fmtN = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) return Number(v).toLocaleString("en-US");
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};
const cell = (s: string) => s.replace(/\|/g, "\\|");
const code = (v: unknown) => `\`${cell(fmtN(v).replace(/`/g, "'"))}\``;
const short = (p: string) => p.replace(/^apps\/vendure\/src\/seed\//, "");
const dot = (s: RuleHit["severity"]) => (s === "high" ? RED : YELLOW);

const GROUPS: { rule: RuleHit["rule"]; title: string }[] = [
  { rule: "price", title: "Prices" },
  { rule: "removed", title: "Removed products" },
  { rule: "fitment", title: "Fitment" },
  { rule: "stock", title: "Stock" },
];

function change(h: RuleHit): string {
  if (h.rule === "removed") return "removed";
  if (h.rule === "fitment") return `fitment ${code(h.before)} → empty`;
  if (h.rule === "stock") return `stock ${fmtN(h.before)} → ${fmtN(h.after)}`;
  const tag = h.note.split(" · ")[0]; // "÷100" or "+340%"
  return `${fmtN(h.before)} → ${fmtN(h.after)} (${tag})`;
}

function fileDot(r: Report, path: string): string {
  const hs = r.hits.filter((h) => h.file === path);
  if (hs.some((h) => h.severity === "high")) return RED;
  if (hs.length) return YELLOW;
  return GREEN;
}

function changesOf(f: FileReport): string {
  if (f.kind === "csv") {
    const p = [f.changed && `${f.changed} changed`, f.removed && `${f.removed} removed`, f.added && `${f.added} added`].filter(Boolean);
    return p.join(" · ") || "no row changes";
  }
  if (f.kind === "json") {
    const c = f.changes.filter((x) => x.kind === "changed").length;
    const a = f.changes.filter((x) => x.kind === "added").length;
    const d = f.changes.filter((x) => x.kind === "removed").length;
    const p = [c && `${c} value${c === 1 ? "" : "s"}`, a && `${a} added`, d && `${d} removed`].filter(Boolean);
    return p.join(" · ") || "formatting only";
  }
  return "";
}

export function renderMarkdown(r: Report): string {
  const L: string[] = [];
  const csvs = r.files.filter((f): f is CsvReport => f.kind === "csv");
  const jsons = r.files.filter((f): f is JsonReport => f.kind === "json");
  const dataFiles: (CsvReport | JsonReport)[] = [...csvs, ...jsons];
  const codeFiles = r.files.filter((f) => f.kind === "code");
  const gitOf = (p: string) => r.git.find((g) => g.path === p);
  const high = r.hits.filter((h) => h.severity === "high").length;
  const filesWithIssues = new Set(r.hits.map((h) => h.file)).size;
  const n = r.hits.length;

  L.push(`### Bites the Data · data impact`);
  L.push("");
  if (high) L.push(`${RED} **Review needed** — ${n} issue${n === 1 ? "" : "s"} in ${filesWithIssues} of ${dataFiles.length} data files`);
  else if (n) L.push(`${YELLOW} **Check** — ${n} medium issue${n === 1 ? "" : "s"} in ${filesWithIssues} of ${dataFiles.length} data files`);
  else L.push(`${GREEN} **No data issues** — ${dataFiles.length} data file${dataFiles.length === 1 ? "" : "s"} changed, all routine`);
  L.push("");

  // Files.
  L.push(`| | File | Rows | Changes | git shows |`);
  L.push(`|:-:|:--|:--|:--|:--|`);
  for (const f of dataFiles) {
    const g = gitOf(f.path);
    const rows = f.kind === "csv" ? `${f.rowsBefore} → ${f.rowsAfter}` : "–";
    L.push(`| ${fileDot(r, f.path)} | ${cell(short(f.path))} | ${rows} | ${changesOf(f)} | +${g?.additions ?? 0} −${g?.deletions ?? 0} |`);
  }
  L.push("");

  // Issues: one table, grouped by type, high before medium inside each group.
  if (n) {
    L.push(`| | Issue | Before → after |`);
    L.push(`|:-:|:--|:--|`);
    for (const g of GROUPS) {
      const hs = r.hits.filter((h) => h.rule === g.rule).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
      if (!hs.length) continue;
      L.push(`| | **${g.title} · ${hs.length}** | |`);
      for (const h of hs) L.push(`| ${dot(h.severity)} | \`${cell(h.label)}\` | ${change(h)} |`);
    }
    L.push("");
  }

  // Routine.
  const okFiles = csvs.filter((f) => f.okPriceChanges.count);
  const ok = okFiles.reduce((s, f) => s + f.okPriceChanges.count, 0);
  const green: string[] = [];
  if (ok) {
    const lo = Math.min(...okFiles.map((f) => f.okPriceChanges.minPct));
    const hi = Math.max(...okFiles.map((f) => f.okPriceChanges.maxPct));
    const sg = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
    green.push(`${GREEN} ${ok} other price changes look routine (${sg(lo)} to ${sg(hi)})`);
  }
  const clean = dataFiles.filter((f) => !r.hits.some((h) => h.file === f.path));
  if (clean.length && n) green.push(`${GREEN} No issues in ${clean.map((f) => `\`${short(f.path)}\``).join(", ")}`);
  if (green.length) {
    L.push(green.join("<br>"));
    L.push("");
  }
  if (codeFiles.length) {
    L.push(`<sub>Code files not diffed (code review is GitHub's job): ${codeFiles.map((f) => `\`${f.path}\``).join(", ")}</sub>`);
    L.push("");
  }

  // Everything, collapsed.
  const total = csvs.reduce((s, f) => s + f.changedRows.reduce((x, row) => x + Object.keys(row.cells).length, 0) + f.removedRows.length + f.addedRows.length, 0) + jsons.reduce((s, f) => s + f.changes.length, 0);
  L.push(`<details><summary>All data changes (${total})</summary>`);
  L.push("");
  for (const f of csvs) {
    L.push(`**${short(f.path)}** · keyed by \`${f.key}\``);
    L.push("");
    L.push(`| ${f.key} | Column | Before → after |`);
    L.push(`|:--|:--|:--|`);
    for (const row of f.removedRows) L.push(`| \`${row.key}\` | row | removed |`);
    for (const row of f.changedRows)
      for (const [col, ch] of Object.entries(row.cells)) L.push(`| \`${row.key}\` | ${col.replace(/^product:/, "")} | ${code(ch.before)} → ${code(ch.after)} |`);
    for (const row of f.addedRows) L.push(`| \`${row.key}\` | row | added |`);
    L.push("");
  }
  for (const f of jsons) {
    L.push(`**${short(f.path)}**`);
    L.push("");
    L.push(`| Path | Before → after |`);
    L.push(`|:--|:--|`);
    for (const c of f.changes.slice(0, 60)) L.push(`| \`${cell(c.path)}\` | ${c.kind === "added" ? `empty → ${code(c.after)}` : c.kind === "removed" ? `${code(c.before)} → removed` : `${code(c.before)} → ${code(c.after)}`} |`);
    if (f.changes.length > 60) L.push(`| …${f.changes.length - 60} more | |`);
    L.push("");
  }
  L.push(`</details>`);
  L.push("");

  // Footer.
  const a = r.archil;
  const ex = a.createExecCalls ?? a.execCalls;
  const archil = a.ok
    ? `Archil: checkpoints \`${a.baseRef}\` → \`${a.headRef}\` on disk \`${a.disk}\`${a.branch ? ` · branch \`${a.branch}\`` : ""} · ${ex} exec call${ex === 1 ? "" : "s"} · sha256 verified`
    : `Archil: not used (${a.note ?? "unavailable"}); diffed locally`;
  L.push(`<sub>${archil}<br>**[Open full diff →](${r.reportUrl})** · \`${r.pr.baseSha.slice(0, 7)}\` → \`${r.pr.headSha.slice(0, 7)}\` · updated ${r.generatedAt.replace("T", " ").slice(0, 16)} UTC · served by the reviewer's Bites the Data instance (localhost)</sub>`);
  return L.join("\n") + "\n";
}
