// Server-rendered report page in the Bites the Data look (light only).
import type { CsvReport, JsonReport, RuleHit } from "./analyze.ts";
import type { Report } from "./report.ts";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) return Number(v).toLocaleString("en-US");
  if (typeof v === "string") return v;
  return JSON.stringify(v);
};
const val = (v: unknown, cls = "") => {
  const s = fmt(v);
  return s === "" ? `<span class="nil ${cls}">empty</span>` : `<span class="v ${cls}" title="${esc(s)}">${esc(s.length > 90 ? s.slice(0, 87) + "…" : s)}</span>`;
};
const short = (p: string) => p.replace(/^apps\/vendure\/src\/seed\//, "");
const RULE: Record<RuleHit["rule"], string> = { price: "Price", removed: "Removed", fitment: "Fitment", stock: "Stock" };
const RULE_ORDER: RuleHit["rule"][] = ["price", "removed", "fitment", "stock"];

const FONT_CSS = `
@font-face{font-family:Inter;font-weight:400;src:url(/fonts/inter-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:Inter;font-weight:500;src:url(/fonts/inter-latin-500-normal.woff2) format("woff2")}
@font-face{font-family:Inter;font-weight:600;src:url(/fonts/inter-latin-600-normal.woff2) format("woff2")}
@font-face{font-family:Inter;font-weight:700;src:url(/fonts/inter-latin-700-normal.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-weight:500;src:url(/fonts/jetbrains-mono-latin-500-normal.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-weight:600;src:url(/fonts/jetbrains-mono-latin-600-normal.woff2) format("woff2")}
@font-face{font-family:"Pixelify Sans";font-weight:600;src:url(/fonts/pixelify-sans-latin-600-normal.woff2) format("woff2")}`;

const CSS = `${FONT_CSS}
:root{--bg:#F5F4F0;--card:#FFFFFF;--ink:#0D0F14;--ink2:#4A4F5C;--ink3:#8A8F9A;--line:#E3E1DA;--blue:#1A2BFF;--blue-bg:#EEF0FF;--red:#D7263D;--red-bg:#FCEBED;--green:#12965A;--green-bg:#E7F5EE;--amber:#C27C00;--amber-bg:#FFF5DF;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.top{display:flex;align-items:center;gap:12px;padding:14px 32px;border-bottom:1px solid var(--line);background:var(--bg)}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em}
.mark{width:22px;height:18px;display:grid;grid-template-columns:repeat(5,1fr);gap:1px}
.mark i{background:var(--blue)}.mark i.o{background:transparent}
.top .tag{font:600 11px var(--mono);color:var(--ink3);text-transform:uppercase;letter-spacing:.08em;border:1px solid var(--line);border-radius:4px;padding:2px 7px}
.top .sp{flex:1}
.wrap{max-width:1180px;margin:0 auto;padding:28px 32px 64px}
.eyebrow{font:600 12px var(--mono);color:var(--ink3);text-transform:uppercase;letter-spacing:.08em}
h1{font-size:28px;line-height:1.2;letter-spacing:-.02em;margin:6px 0 8px;font-weight:700}
h1 .num{color:var(--ink3);font-weight:500}
.meta{color:var(--ink2);display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.meta code,.mono{font:500 12.5px var(--mono)}
.meta .branch{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:1px 6px}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--ink);border-radius:6px;padding:6px 12px;font-weight:600;color:var(--ink);background:var(--card)}
.btn:hover{text-decoration:none;background:var(--ink);color:#fff}
.verdict{margin:22px 0 8px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.chip{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:5px 12px;font-weight:600;font-size:13px;border:1px solid}
.chip.bad{color:var(--red);background:var(--red-bg);border-color:#F3C4CB}
.chip.ok{color:var(--green);background:var(--green-bg);border-color:#BFE4D2}
.chip.info{color:var(--blue);background:var(--blue-bg);border-color:#CDD2FF}
.chip b{font-family:var(--mono)}
.dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.sd{display:inline-block;width:8px;height:8px;border-radius:50%;vertical-align:middle;flex:none}
.sd.high{background:var(--red)}.sd.medium{background:var(--amber)}.sd.ok{background:var(--green)}
.chip.med{color:var(--amber);background:var(--amber-bg);border-color:#F1DCA8}
td.sdc{width:28px;text-align:center;padding-right:0!important}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border:1px solid var(--line);border-radius:10px;background:var(--card);margin:20px 0 28px;overflow:hidden}
.stat{padding:14px 18px;border-right:1px solid var(--line)}.stat:last-child{border-right:0}
.stat .k{font:600 11px var(--mono);color:var(--ink3);text-transform:uppercase;letter-spacing:.07em}
.stat .n{font:600 24px var(--mono);letter-spacing:-.02em;margin-top:2px}
.stat .n.red{color:var(--red)}.stat .n.blue{color:var(--blue)}
.stat .s{color:var(--ink3);font-size:12px}
.grid2{display:grid;grid-template-columns:1.25fr 1fr;gap:20px;margin-bottom:28px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.card h2,.sec h2{font-size:15px;margin:0;font-weight:700;letter-spacing:-.01em}
.card .hd{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}
.card .hd .sub{color:var(--ink3);font-size:12.5px;margin-left:auto}
.cmp{width:100%;border-collapse:collapse}
.cmp th{font:600 11px var(--mono);text-transform:uppercase;letter-spacing:.07em;color:var(--ink3);text-align:left;padding:9px 18px;border-bottom:1px solid var(--line);background:#FBFAF7}
.cmp td{padding:11px 18px;border-bottom:1px solid var(--line);vertical-align:top}
.cmp tr:last-child td{border-bottom:0}
.cmp .git{font:500 12.5px var(--mono);color:var(--ink2);white-space:nowrap}
.cmp .we ul{margin:0;padding:0;list-style:none}.cmp .we li{padding:1px 0}
.cmp .git .a{color:var(--green)}.cmp .git .d{color:var(--red)}
.cmp .we{font-weight:500}
.cmp .we .bad{color:var(--red);font-weight:600}
.kv{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;padding:16px 18px;margin:0}
.kv dt{font:600 11px var(--mono);color:var(--ink3);text-transform:uppercase;letter-spacing:.07em;padding-top:2px}
.kv dd{margin:0;font:500 13px var(--mono)}
.kv dd .pill{display:inline-block;background:var(--blue-bg);color:var(--blue);border-radius:4px;padding:0 6px;margin-right:4px}
.kv dd.okv{color:var(--green)}
.note{padding:10px 18px;border-top:1px solid var(--line);color:var(--ink2);font-size:12.5px;background:#FBFAF7}
.sec{margin:30px 0 12px;display:flex;align-items:baseline;gap:12px}
.sec .sub{color:var(--ink3);font-size:13px}
table.d{width:100%;border-collapse:collapse;font-size:13px}
table.d th{font:600 11px var(--mono);text-transform:uppercase;letter-spacing:.07em;color:var(--ink3);text-align:left;padding:9px 14px;border-bottom:1px solid var(--line);background:#FBFAF7;position:sticky;top:0}
table.d td{padding:8px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
table.d tr:last-child td{border-bottom:0}
table.d td.key{font:500 12px var(--mono);color:var(--ink2);white-space:nowrap}
table.d td.item{font-weight:500}
table.d td.col{font:500 12px var(--mono);color:var(--ink2)}
.v,.nil{font:500 12.5px var(--mono);border-radius:4px;padding:2px 6px;display:inline-block;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}
.v.before{background:var(--red-bg);color:#8E1324;text-decoration:line-through;text-decoration-color:rgba(215,38,61,.45)}
.v.after{background:var(--green-bg);color:#0B6B40}
.v.after.bad{background:var(--red);color:#fff;font-weight:600}
.nil{color:var(--ink3);background:#F0EFEA;font-style:italic}
.nil.after{background:var(--red-bg);color:var(--red);font-style:normal;font-weight:600}
.arrow{color:var(--ink3);margin:0 6px}
tr.flag td:first-child{box-shadow:inset 3px 0 0 var(--red)}
tr.flag{background:#FFF8F8}
tr.gone td{background:#FDF1F2}
tr.gone .item{color:#8E1324;text-decoration:line-through;text-decoration-color:rgba(215,38,61,.45)}
.rule{font:600 11px var(--mono);text-transform:uppercase;letter-spacing:.06em;border-radius:4px;padding:2px 7px;color:var(--red);background:var(--red-bg);white-space:nowrap}
.rule.medium{color:var(--amber);background:var(--amber-bg)}
.why.medium{color:var(--amber)}
tr.flag.medium{background:#FFFBF1}tr.flag.medium td:first-child{box-shadow:inset 3px 0 0 var(--amber)}
.v.after.warn{background:var(--amber);color:#fff;font-weight:600}
.why{font:600 12px var(--mono);color:var(--red);white-space:nowrap}
.okline{color:var(--green);font-weight:500;padding:10px 14px;border-top:1px solid var(--line);background:#F6FBF8;font-size:13px}
.file .hd .path{font:600 13px var(--mono)}
.file .hd .badge{font:600 11px var(--mono);border:1px solid var(--line);border-radius:4px;padding:1px 6px;color:var(--ink2)}
.file{margin-bottom:18px}
.scroll{max-height:560px;overflow:auto}
.codefiles{color:var(--ink2);font-size:13px;margin-top:8px}
.foot{margin-top:40px;color:var(--ink3);font-size:12px;display:flex;gap:16px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:16px}
@media (max-width:820px){.grid2{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.wrap,.top{padding-left:16px;padding-right:16px}}
`;

// 5x4 pixel rewind mark (two left-pointing triangles), drawn as a grid.
const MARK = [
  "..x.x",
  ".xx.x",
  "xxxxx",
  ".xx.x",
];
const markHtml = `<span class="mark" style="grid-template-rows:repeat(4,1fr)">${MARK.join("").split("").map((c) => `<i class="${c === "x" ? "" : "o"}"></i>`).join("")}</span>`;

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="top"><span class="logo">${markHtml}Bites the Data</span><span class="tag">PR check</span><span class="sp"></span><a href="/pr">All PR reports</a></div>
${body}</body></html>`;
}

function hitRow(h: RuleHit): string {
  const after = h.rule === "removed" ? `<span class="nil after">row deleted</span>` : h.rule === "fitment" ? `<span class="nil after">empty</span>` : val(h.after, h.severity === "high" ? "after bad" : "after warn");
  const before = h.rule === "removed" ? `<span class="v before">${esc(fmt(h.before))}</span>` : val(h.before, "before");
  return `<tr class="flag ${h.severity}"><td class="sdc"><span class="sd ${h.severity}" title="${h.severity}"></span></td><td><span class="rule ${h.severity}">${RULE[h.rule]}</span></td><td class="item">${esc(h.label)}</td><td class="col">${esc(h.column.replace(/^product:/, ""))}</td><td>${before}<span class="arrow">→</span>${after}</td><td class="why ${h.severity}">${esc(h.note)}</td></tr>`;
}

function csvSection(f: CsvReport, hits: RuleHit[]): string {
  const sev = new Map<string, RuleHit["severity"]>(hits.filter((h) => h.file === f.path).map((h) => [`${h.key}|${h.column}`, h.severity]));
  const flagged = { has: (k: string) => sev.has(k) };
  const rows: string[] = [];
  const changed = [...f.changedRows].sort((a, b) => {
    const fa = Object.keys(a.cells).some((c) => flagged.has(`${a.key}|${c}`)) ? 0 : 1;
    const fb = Object.keys(b.cells).some((c) => flagged.has(`${b.key}|${c}`)) ? 0 : 1;
    return fa - fb;
  });
  for (const r of f.removedRows)
    rows.push(`<tr class="gone flag"><td class="key">${esc(r.key)}</td><td class="item">${esc(r.label)}</td><td class="col">row</td><td><span class="v before">${esc(fmt(r.row.price))} · stock ${esc(fmt(r.row.stockOnHand))}</span><span class="arrow">→</span><span class="nil after">removed</span></td></tr>`);
  for (const r of changed)
    for (const [c, ch] of Object.entries(r.cells)) {
      const sv = sev.get(`${r.key}|${c}`);
      const isFlag = !!sv;
      rows.push(`<tr class="${isFlag ? `flag ${sv}` : ""}"><td class="key">${esc(r.key)}</td><td class="item">${esc(r.label)}</td><td class="col">${esc(c.replace(/^product:/, ""))}</td><td>${val(ch.before, "before")}<span class="arrow">→</span>${val(ch.after, sv === "high" ? "after bad" : sv === "medium" ? "after warn" : "after")}</td></tr>`);
    }
  for (const r of f.addedRows)
    rows.push(`<tr><td class="key">${esc(r.key)}</td><td class="item">${esc(r.label)}</td><td class="col">row</td><td><span class="nil">none</span><span class="arrow">→</span><span class="v after">added</span></td></tr>`);
  const ok = f.okPriceChanges;
  return `<div class="card file"><div class="hd"><span class="path">${esc(short(f.path))}</span><span class="badge">CSV · keyed by ${esc(f.key)}</span><span class="badge">${f.rowsBefore} → ${f.rowsAfter} rows</span><span class="sub">${esc(f.summary)}</span></div>
<div class="scroll"><table class="d"><thead><tr><th style="width:170px">${esc(f.key)}</th><th>Item</th><th style="width:170px">Column</th><th>Before → after</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
${ok.count ? `<div class="okline">${ok.count} price changes within ${ok.minPct >= 0 ? "+" : ""}${ok.minPct.toFixed(1)}% to +${ok.maxPct.toFixed(1)}%: routine supplier sync, not flagged.</div>` : ""}</div>`;
}

function jsonSection(f: JsonReport): string {
  const rows = f.changes
    .map((c) => {
      const b = c.kind === "added" ? `<span class="nil">none</span>` : val(c.before, "before");
      const a = c.kind === "removed" ? `<span class="nil after">removed</span>` : val(c.after, "after");
      return `<tr><td class="col" style="white-space:nowrap">${esc(c.path)}</td><td>${b}<span class="arrow">→</span>${a}</td></tr>`;
    })
    .join("");
  return `<div class="card file"><div class="hd"><span class="path">${esc(short(f.path))}</span><span class="badge">JSON · path diff</span><span class="sub">${esc(f.summary)}</span></div>
<div class="scroll"><table class="d"><thead><tr><th style="width:46%">Path</th><th>Before → after</th></tr></thead><tbody>${rows || `<tr><td colspan="2">No value changes</td></tr>`}</tbody></table></div></div>`;
}

function weShow(r: Report, path: string): string {
  const f = r.files.find((x) => x.path === path);
  if (!f) return "";
  const hits = r.hits.filter((h) => h.file === path);
  const c = (k: RuleHit["rule"]) => hits.filter((h) => h.rule === k).length;
  if (f.kind === "csv") {
    const parts = [`${f.changed} rows changed, keyed by ${esc(f.key)}`];
    if (c("price")) parts.push(`<span class="bad">${c("price")} prices off by ~100x</span>`);
    if (f.removed) parts.push(`<span class="bad">${f.removed} products removed</span>`);
    if (c("fitment")) parts.push(`<span class="bad">fitment lost on ${c("fitment")} product${c("fitment") === 1 ? "" : "s"}</span>`);
    if (c("stock")) parts.push(`<span class="bad">${c("stock")} SKUs set to 0 stock</span>`);
    return `<ul>${parts.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  }
  if (f.kind === "json") return esc(f.summary) + (hits.length ? ` · <span class="bad">${hits.length} flagged</span>` : " · nothing flagged");
  return esc(f.note);
}

function fileSev(r: Report, path: string): "high" | "medium" | "ok" {
  const hs = r.hits.filter((h) => h.file === path);
  return hs.some((h) => h.severity === "high") ? "high" : hs.length ? "medium" : "ok";
}

export function renderPage(r: Report): string {
  const csvs = r.files.filter((f): f is CsvReport => f.kind === "csv");
  const jsons = r.files.filter((f): f is JsonReport => f.kind === "json");
  const codeFiles = r.files.filter((f) => f.kind === "code" || f.kind === "data-unparsed");
  const rowsChanged = csvs.reduce((s, f) => s + f.changed + f.removed + f.added, 0);
  const jsonVals = jsons.reduce((s, f) => s + f.total, 0);
  const ok = csvs.reduce((s, f) => s + f.okPriceChanges.count, 0);
  const a = r.archil;
  const hits = [...r.hits].sort((x, y) => RULE_ORDER.indexOf(x.rule) - RULE_ORDER.indexOf(y.rule));
  const gitTotal = r.git.reduce((s, g) => ({ a: s.a + g.additions, d: s.d + g.deletions }), { a: 0, d: 0 });

  const chips = r.verdict.parts.map((p) => `<span class="chip ${/stock|increase/i.test(p) && !/price/i.test(p) ? "med" : "bad"}"><span class="dot"></span>${esc(p)}</span>`).join("") +
    (ok ? `<span class="chip ok"><span class="dot"></span>${ok} routine price changes</span>` : "") +
    (r.verdict.level === "ok" ? `<span class="chip ok"><span class="dot"></span>No risky data changes</span>` : "");

  const body = `<div class="wrap">
<div class="eyebrow">${esc(r.repo)} · pull request · data impact</div>
<h1>${esc(r.pr.title)} <span class="num">#${r.pr.number}</span></h1>
<div class="meta"><span>by <b>${esc(r.pr.author)}</b></span><span class="branch mono">${esc(r.pr.headRef)}</span><span>into</span><span class="branch mono">${esc(r.pr.baseRef)}</span><span class="mono">${esc(r.pr.baseSha.slice(0, 7))} → ${esc(r.pr.headSha.slice(0, 7))}</span><span class="sp" style="flex:1"></span><a class="btn" href="${esc(r.pr.url)}" target="_blank" rel="noopener">View PR on GitHub →</a></div>
<div class="verdict">${chips}</div>
<div class="stats">
 <div class="stat"><div class="k">Flagged</div><div class="n red">${r.hits.length}</div><div class="s">by catalog rules</div></div>
 <div class="stat"><div class="k">Rows touched</div><div class="n">${rowsChanged}</div><div class="s">across ${csvs.length} CSV file${csvs.length === 1 ? "" : "s"}</div></div>
 <div class="stat"><div class="k">JSON values</div><div class="n">${jsonVals}</div><div class="s">across ${jsons.length} JSON file${jsons.length === 1 ? "" : "s"}</div></div>
 <div class="stat"><div class="k">git says</div><div class="n">+${gitTotal.a} −${gitTotal.d}</div><div class="s">lines, ${r.git.length} files</div></div>
 <div class="stat"><div class="k">Archil exec</div><div class="n blue">${a.ok ? a.createExecCalls ?? a.execCalls : "—"}</div><div class="s">${a.ok ? `${a.checkpointReads} checkpoint reads` : "local fallback"}</div></div>
</div>

<div class="grid2">
 <div class="card"><div class="hd"><h2>What git shows vs what we show</h2></div>
  <table class="cmp"><thead><tr><th style="width:28px"></th><th>File</th><th>git</th><th>Bites the Data</th></tr></thead><tbody>
  ${r.git.filter((g) => g.data).map((g) => `<tr><td class="sdc"><span class="sd ${fileSev(r, g.path)}"></span></td><td class="mono">${esc(short(g.path))}</td><td class="git"><span class="a">+${g.additions}</span> <span class="d">−${g.deletions}</span> lines</td><td class="we">${weShow(r, g.path)}</td></tr>`).join("")}
  </tbody></table></div>
 <div class="card"><div class="hd"><h2>Archil</h2><span class="sub">${a.ok ? esc(`${a.region}`) : "not used"}</span></div>
  ${a.ok ? `<dl class="kv">
   <dt>Disk</dt><dd>${esc(a.disk)} <span style="color:var(--ink3)">${esc(a.diskId)}</span></dd>
   <dt>Checkpoints</dt><dd><span class="pill">${esc(a.baseRef)}</span><span class="pill">${esc(a.headRef)}</span></dd>
   <dt>Branch</dt><dd>${a.branch ? `<span class="pill">${esc(a.branch)}</span> from ${esc(a.headRef)}` : "none"}</dd>
   <dt>Exec calls</dt><dd>${a.createExecCalls ?? a.execCalls} (one per checkpoint)${a.reused ? " · this re-run: 0" : ""}</dd>
   <dt>Reads</dt><dd>${a.checkpointReads} file versions by checkpoint · ${(a.bytesRead / 1024).toFixed(0)} KB</dd>
   <dt>Integrity</dt><dd class="okv">sha256 verified against GitHub blobs</dd>
  </dl>` : `<div class="note">${esc(a.note ?? "Archil unavailable")}; diffed locally from the GitHub blobs.</div>`}
  <div class="note">Every PR gets its own Archil branch: roll the catalog back to <span class="mono">${esc(a.baseRef ?? "base")}</span> or fork from <span class="mono">${esc(a.headRef ?? "head")}</span> without touching git.</div>
 </div>
</div>

${hits.length ? `<div class="sec"><h2>Flagged by rules</h2><span class="sub">price moves over 50% · products removed · fitment emptied · stock set to 0</span></div>
<div class="card"><table class="d"><thead><tr><th style="width:28px"></th><th style="width:110px">Rule</th><th>Item</th><th style="width:190px">Column</th><th>Before → after</th><th style="width:130px">Why</th></tr></thead><tbody>${hits.map(hitRow).join("")}</tbody></table></div>` : ""}

<div class="sec"><h2>Typed diff per file</h2><span class="sub">rows keyed by sku, JSON by path; flagged rows first</span></div>
${csvs.map((f) => csvSection(f, r.hits)).join("")}
${jsons.map(jsonSection).join("")}
${codeFiles.length ? `<div class="codefiles">Not diffed here: ${codeFiles.map((f) => `<span class="mono">${esc(f.path)}</span>`).join(", ")}. Code review is GitHub's job.</div>` : ""}
<div class="foot"><span>Generated ${esc(r.generatedAt.replace("T", " ").slice(0, 19))} UTC</span><span>Served by your local Bites the Data instance</span><a href="/pr/${r.pr.number}.json">Raw report JSON</a></div>
</div>`;
  return shell(`PR #${r.pr.number} · Bites the Data`, body);
}

export function renderIndex(reports: Report[]): string {
  const rows = reports
    .map((r) => `<tr><td class="key">#${r.pr.number}</td><td class="item"><a href="/pr/${r.pr.number}">${esc(r.pr.title)}</a></td><td class="col">${esc(r.repo)}</td><td>${r.verdict.level === "warn" ? `<span class="why">${esc(r.verdict.text)}</span>` : `<span style="color:var(--green)">clean</span>`}</td></tr>`)
    .join("");
  return shell("PR reports · Bites the Data", `<div class="wrap"><div class="eyebrow">PR check</div><h1>Pull request reports</h1><div class="card" style="margin-top:20px"><table class="d"><thead><tr><th>PR</th><th>Title</th><th>Repo</th><th>Verdict</th></tr></thead><tbody>${rows || `<tr><td colspan="4">No reports yet.</td></tr>`}</tbody></table></div></div>`);
}
