// Bites the Data PR check.
//   npx tsx prcheck/pr-check.ts --repo Akmalchan/GEARGO --pr 106 [--post] [--local]
// Fetches base/head of every data file in the PR, checkpoints both on Archil
// (pr<n>-base / pr<n>-head, plus an Archil branch pr<n>), reads them back by
// checkpoint, runs the typed diff + catalog rules, and writes a Markdown comment
// and a JSON report (served by prcheck/server.ts at /pr/<n>).
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { DELTA_DIR, PORT, REPORTS_DIR } from "./lib/paths.ts";
config({ path: `${DELTA_DIR}/.env`, quiet: true });

import { analyzeCsv, analyzeJson, isDataFile, type FileReport, type RuleHit } from "./lib/analyze.ts";
import { PrArchil, loadState, saveState, sha256 } from "./lib/archil.ts";
import { fileAt, prFiles, prMeta, upsertComment, type PrFile } from "./lib/github.ts";
import { renderMarkdown } from "./lib/markdown.ts";
import { verdictOf, type ArchilInfo, type GitLine, type Report } from "./lib/report.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const repo = arg("repo") ?? "Akmalchan/GEARGO";
const n = Number(arg("pr"));
if (!n) {
  console.error("usage: npx tsx prcheck/pr-check.ts --repo owner/name --pr <n> [--post] [--local]");
  process.exit(2);
}

const log = (s: string) => console.log(`  ${s}`);
const t0 = performance.now();

console.log(`Bites the Data · PR check · ${repo}#${n}`);
const pr = prMeta(repo, n);
const files = prFiles(repo, n);
const data = files.filter((f) => isDataFile(f.path) || (f.previousPath && isDataFile(f.previousPath)));
log(`"${pr.title}" by ${pr.author} · ${files.length} files changed, ${data.length} data files`);
log(`base ${pr.baseRef}@${pr.baseSha.slice(0, 7)} → head ${pr.headRef}@${pr.headSha.slice(0, 7)}`);

// 1. Fetch both sides from GitHub.
interface Side { path: string; buf: Buffer | null }
const basePath = (f: PrFile) => f.previousPath ?? f.path;
const pairs = await Promise.all(
  data.map(async (f) => ({
    f,
    base: { path: basePath(f), buf: f.status === "added" ? null : await fileAt(repo, basePath(f), pr.baseSha) } as Side,
    head: { path: f.path, buf: f.status === "removed" ? null : await fileAt(repo, f.path, pr.headSha) } as Side,
  })),
);
log(`fetched ${pairs.length * 2 - pairs.filter((p) => !p.base.buf || !p.head.buf).length} file versions from GitHub`);

// 2. Archil: checkpoint base and head, branch the head, read both back by checkpoint.
const archilInfo: ArchilInfo = { ok: false, execCalls: 0, objectWrites: 0, checkpointReads: 0, bytesRead: 0, reused: false, hashVerified: false, ms: 0 };
async function viaArchil(): Promise<void> {
  if (flag("local")) throw new Error("--local");
  const ta = performance.now();
  const ar = new PrArchil();
  await ar.init();
  const st = loadState();
  st.prs ??= {};
  const prev = st.prs[String(n)];
  const sha7 = pr.headSha.slice(0, 7);
  let rec = prev;
  if (!(prev && prev.baseSha === pr.baseSha && prev.headSha === pr.headSha)) {
    const suffix = prev ? `-${sha7}` : "";
    const dir = `prs/pr${n}/${sha7}-${Date.now().toString(36)}`;
    rec = { baseSha: pr.baseSha, headSha: pr.headSha, dir, baseRef: `pr${n}-base${suffix}`, headRef: `pr${n}-head${suffix}` };
    // Base world: object API writes (no exec), then one exec to hash + checkpoint.
    await Promise.all(pairs.filter((p) => p.base.buf).map((p) => ar.write(`${dir}/${p.base.path}`, p.base.buf!)));
    const cb = await ar.checkpoint(dir, rec.baseRef);
    log(`Archil checkpoint ${rec.baseRef} (${cb.ms} ms)`);
    for (const p of pairs) if (p.base.buf && cb.hashes[p.base.path] !== sha256(p.base.buf)) throw new Error(`server hash mismatch for ${p.base.path} at base`);
    // Head world: same folder, apply the PR (writes, deletes, renames).
    await Promise.all(pairs.filter((p) => !p.head.buf || p.base.path !== p.head.path).map((p) => ar.remove(`${dir}/${p.base.path}`)));
    await Promise.all(pairs.filter((p) => p.head.buf).map((p) => ar.write(`${dir}/${p.head.path}`, p.head.buf!)));
    const ch = await ar.checkpoint(dir, rec.headRef);
    log(`Archil checkpoint ${rec.headRef} (${ch.ms} ms)`);
    for (const p of pairs) if (p.head.buf && ch.hashes[p.head.path] !== sha256(p.head.buf)) throw new Error(`server hash mismatch for ${p.head.path} at head`);
    try {
      rec.branch = await ar.branch(`pr${n}${suffix}`, rec.headRef);
      log(`Archil branch ${rec.branch} from ${rec.headRef}`);
    } catch (e) {
      archilInfo.note = `branch not created: ${String((e as Error).message).slice(0, 80)}`;
    }
    rec.execCalls = ar.execCalls;
    st.prs[String(n)] = { ...prev, ...rec };
    saveState(st);
  } else {
    archilInfo.reused = true;
    log(`reusing checkpoints ${rec!.baseRef} / ${rec!.headRef} (same SHAs, 0 exec calls)`);
  }
  // Read every version back by checkpoint (S3 GetObject versionId=<checkpoint>), hash-verified.
  await Promise.all(
    pairs.flatMap((p) => [
      p.base.buf ? ar.readAt(`${rec!.dir}/${p.base.path}`, rec!.baseRef, sha256(p.base.buf)).then((b) => (p.base.buf = b)) : null,
      p.head.buf ? ar.readAt(`${rec!.dir}/${p.head.path}`, rec!.headRef, sha256(p.head.buf)).then((b) => (p.head.buf = b)) : null,
    ]),
  );
  log(`read ${ar.checkpointReads} versions back from checkpoints (${ar.bytesRead.toLocaleString("en-US")} bytes, sha256 verified)`);
  Object.assign(archilInfo, {
    ok: true,
    disk: ar.diskName,
    diskId: ar.disk.id,
    region: ar.region,
    baseRef: rec!.baseRef,
    headRef: rec!.headRef,
    branch: rec!.branch,
    execCalls: ar.execCalls,
    createExecCalls: rec!.execCalls ?? ar.execCalls,
    objectWrites: ar.objectWrites,
    checkpointReads: ar.checkpointReads,
    bytesRead: ar.bytesRead,
    hashVerified: true,
    ms: Math.round(performance.now() - ta),
    note: [archilInfo.note, ar.diskNote].filter(Boolean).join("; ") || undefined,
  });
}
try {
  await viaArchil();
} catch (e) {
  const msg = String((e as Error).message);
  archilInfo.ok = false;
  archilInfo.note = msg === "--local" ? "local mode (--local)" : `Archil unavailable, diffed locally: ${msg.slice(0, 120)}`;
  log(`! ${archilInfo.note}`);
}

// 3. Typed diff + rules.
const hits: RuleHit[] = [];
const reports: FileReport[] = [];
for (const p of pairs) {
  const before = p.base.buf?.toString("utf8") ?? "";
  const after = p.head.buf?.toString("utf8") ?? "";
  if (/\.(csv|tsv)$/i.test(p.head.path)) reports.push(analyzeCsv(p.head.path, p.f.status, before, after, hits));
  else if (/\.json$/i.test(p.head.path)) reports.push(analyzeJson(p.head.path, p.f.status, before, after, hits));
  else reports.push({ kind: "data-unparsed", path: p.head.path, status: p.f.status, note: "data file; typed diff for this format not wired into PR check yet" });
}
for (const f of files.filter((f) => !data.includes(f))) reports.push({ kind: "code", path: f.path, status: f.status, note: "code file, not diffed (code review is GitHub's job)" });

const git: GitLine[] = files.map((f) => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions, data: data.includes(f) }));
const report: Report = {
  repo,
  pr,
  generatedAt: new Date().toISOString(),
  files: reports,
  hits,
  git,
  archil: archilInfo,
  verdict: verdictOf(hits),
  reportUrl: `http://localhost:${PORT}/pr/${n}`,
};
mkdirSync(REPORTS_DIR, { recursive: true });
writeFileSync(`${REPORTS_DIR}/pr${n}.json`, JSON.stringify(report, null, 2));
const md = renderMarkdown(report);
writeFileSync(`${REPORTS_DIR}/pr${n}.md`, md);
log(`verdict: ${report.verdict.text}`);
log(`report: ${REPORTS_DIR}/pr${n}.json · comment: ${REPORTS_DIR}/pr${n}.md`);

// 4. Post (or update) the PR comment.
if (flag("post")) {
  const st = loadState();
  st.prs ??= {};
  const cur = st.prs[String(n)];
  const posted = upsertComment(repo, n, md, cur?.commentId);
  st.prs[String(n)] = { ...(cur ?? { baseSha: pr.baseSha, headSha: pr.headSha, dir: "", baseRef: "", headRef: "" }), commentId: posted.id, commentUrl: posted.url };
  saveState(st);
  log(`${posted.updated ? "updated" : "posted"} comment ${posted.url}`);
}
log(`done in ${Math.round(performance.now() - t0)} ms · Archil exec calls this run: ${archilInfo.execCalls}`);
log(`open ${report.reportUrl} (start: npx tsx prcheck/server.ts)`);
