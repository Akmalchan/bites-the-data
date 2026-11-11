// Archil capability smoke test for Delta.
//   npm run smoke:archil              # disk + exec + S3 + checkpoint + versionId + sandbox fork
//   npm run smoke:archil -- --no-sandbox   # skip the sandbox part (saves free-plan compute)
//
// Frugal by design: reuses one disk ("delta-worlds", id cached in data/archil-state.json),
// uses ~6 exec calls, and creates at most 1 sandbox + 1 fork, both deleted at the end.
// Never prints the API key.
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import * as archil from "disk";

type Result = { name: string; ok: boolean | null; ms?: number; note: string };
const results: Result[] = [];
const args = new Set(process.argv.slice(2));
const STATE = "data/archil-state.json";

function record(name: string, ok: boolean | null, note: string, ms?: number) {
  results.push({ name, ok, note, ms });
  const tag = ok === null ? "SKIP" : ok ? "PASS" : "FAIL";
  console.log(`${tag.padEnd(4)}  ${name.padEnd(34)} ${ms !== undefined ? `${ms} ms`.padStart(8) : "".padStart(8)}  ${note}`);
}

function loadState(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}
function saveState(s: Record<string, unknown>) {
  mkdirSync("data", { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}
const scrub = (s: string) => (process.env.ARCHIL_API_KEY ? s.split(process.env.ARCHIL_API_KEY).join("***") : s);
const errText = (e: unknown) => scrub(String((e as Error)?.message ?? e)).slice(0, 160);

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const v = await fn();
  return [v, Math.round(performance.now() - t)];
}

async function main() {
  if (!process.env.ARCHIL_API_KEY) {
    console.log("ARCHIL_API_KEY is not set (put it in .env). Nothing to test; Delta will use the local backend.");
    process.exit(1);
  }
  const region = process.env.ARCHIL_REGION || "aws-us-west-2";
  archil.configure({ apiKey: process.env.ARCHIL_API_KEY, region });
  console.log(`Archil smoke test · region ${region} · disk SDK ${archil.VERSION}\n`);
  const state = loadState();

  // 1. Auth + list disks
  let disks: archil.Disk[] = [];
  try {
    const [list, ms] = await timed(() => archil.listDisks());
    disks = list as unknown as archil.Disk[];
    record("auth + listDisks", true, `${disks.length} disk(s) on account`, ms);
  } catch (e) {
    record("auth + listDisks", false, errText(e));
    return finish(state);
  }

  // 2. Reuse or create the one Delta disk
  let disk: archil.Disk | undefined;
  try {
    const wanted = process.env.ARCHIL_DISK_ID || (state.diskId as string | undefined);
    if (wanted) disk = await archil.getDisk(wanted);
    else disk = disks.find((d) => (d as unknown as { name: string }).name === "delta-worlds");
    if (disk) record("reuse disk", true, `${disk.id}`);
    else {
      const [res, ms] = await timed(() => archil.createDisk({ name: "delta-worlds" }));
      disk = res.disk;
      record("createDisk", true, `${disk.id} (token not stored)`, ms);
    }
    state.diskId = disk.id;
    saveState(state);
  } catch (e) {
    record("get/create disk", false, errText(e));
    return finish(state);
  }

  // 3. Serverless exec (write + read)
  const run = Date.now().toString(36);
  try {
    const [r, ms] = await timed(() =>
      disk!.exec(`mkdir -p delta-smoke && echo v1-${run} > delta-smoke/state.txt && cat delta-smoke/state.txt && (command -v archil || echo no-archil-cli) && (command -v sha256sum || echo no-sha)`),
    );
    const ok = r.exitCode === 0 && r.stdout.includes(`v1-${run}`);
    state.hasArchilCli = !r.stdout.includes("no-archil-cli");
    record("disk.exec write+read", ok, ok ? `queue ${r.timing?.queueMs}ms exec ${r.timing?.executeMs}ms; archil CLI ${state.hasArchilCli ? "present" : "absent"}` : scrub(r.stderr).slice(0, 160), ms);
  } catch (e) {
    record("disk.exec write+read", false, errText(e));
  }

  // 4. S3 object API
  try {
    const [, msPut] = await timed(() => disk!.putObject(`delta-smoke/obj-${run}.txt`, "hello-object"));
    const [bytes, msGet] = await timed(() => disk!.getObject(`delta-smoke/obj-${run}.txt`));
    const ok = Buffer.from(bytes).toString() === "hello-object";
    record("putObject + getObject", ok, ok ? `put ${msPut}ms` : "content mismatch", msGet);
    const [seen, msExec] = await timed(() => disk!.exec(`cat delta-smoke/obj-${run}.txt`));
    record("S3 write visible to exec", seen.stdout.trim() === "hello-object", seen.stdout.trim().slice(0, 40), msExec);
  } catch (e) {
    record("putObject + getObject", false, errText(e));
  }

  // 5. In-disk world copy + manifest (Delta's fork path). Plain exec mounts in shared mode, where some
  //    paths are read-only, so Delta uses a conditional mount for writes.
  try {
    const [r, ms] = await timed(() =>
      archil.exec({
        disks: { w: { disk: disk!.id, conditional: true } },
        command: `cd /mnt/archil/w && rm -rf delta-smoke-w2 && cp -a delta-smoke delta-smoke-w2 && cd delta-smoke-w2 && find . -type f -print0 | xargs -0 -r sha256sum | head -5`,
      }),
    );
    record("cp -a world copy (conditional mount)", r.exitCode === 0 && r.stdout.includes("state.txt"), r.exitCode === 0 ? `${r.stdout.trim().split("\n").length} files hashed` : scrub(r.stderr).slice(0, 160), ms);
  } catch (e) {
    record("cp -a world copy (conditional mount)", false, errText(e));
  }

  // 6. Real Archil checkpoint from inside exec
  const cp = `delta-smoke-${run}`;
  let checkpointOk = false;
  try {
    const [r, ms] = await timed(() =>
      disk!.exec(`sync; archil checkpoints create /mnt/archil ${cp} 2>&1; echo "EXIT=$?"`),
    );
    checkpointOk = /EXIT=0/.test(r.stdout);
    record("archil checkpoints create (in exec)", checkpointOk, scrub(r.stdout.replace(/\s+/g, " ")).slice(0, 160), ms);
    if (checkpointOk) state.lastCheckpoint = cp;
  } catch (e) {
    record("archil checkpoints create (in exec)", false, errText(e));
  }

  // 7. Read a file as of the checkpoint via S3 versionId
  if (checkpointOk) {
    try {
      await disk.putObject("delta-smoke/state.txt", `v2-${run}\n`);
      const t0 = performance.now();
      const s3 = (disk as unknown as { _s3Request: (m: string, k: string, o: unknown) => Promise<{ ok: boolean; status: number; body: Uint8Array }> })._s3Request.bind(disk);
      // A fresh checkpoint answers 503 SlowDown ("not readable yet") for a few seconds; retry up to 45 s.
      const [resp, ms] = await timed(async () => {
        for (;;) {
          const r = await s3("GET", "delta-smoke/state.txt", { query: { versionId: cp } });
          if (r.status !== 503 || performance.now() - t0 > 45_000) return r;
          await new Promise((res) => setTimeout(res, 1000));
        }
      });
      const old = Buffer.from(resp.body).toString().trim();
      const now = Buffer.from(await disk.getObject("delta-smoke/state.txt")).toString().trim();
      const ok = resp.ok && old === `v1-${run}` && now === `v2-${run}`;
      state.versionIdReads = ok;
      record("getObject at checkpoint (versionId)", ok, resp.ok ? `checkpoint="${old}" head="${now}"` : `HTTP ${resp.status}: ${scrub(Buffer.from(resp.body).toString()).slice(0, 120)}`, ms);
    } catch (e) {
      record("getObject at checkpoint (versionId)", false, errText(e));
    }
  } else record("getObject at checkpoint (versionId)", null, "skipped: no checkpoint");

  // 8. Sandbox create + fork + isolation
  if (args.has("--no-sandbox")) record("sandbox create/fork", null, "skipped (--no-sandbox)");
  else {
    let sb: archil.Sandbox | undefined;
    let fork: archil.Sandbox | undefined;
    try {
      const [s, ms] = await timed(() =>
        archil.createSandbox({ name: `delta-smoke-${run}`, vcpuCount: 1, memSizeMiB: 1024, maxTtlSeconds: 600, idleTtlSeconds: 120 }),
      );
      sb = s;
      state.smokeSandboxId = sb.id;
      saveState(state);
      record("createSandbox (1 vCPU)", true, `${sb.id} ${sb.status}`, ms);
      const w = await sb.exec("mkdir -p /workspace && echo base > /workspace/state.txt && cat /workspace/state.txt");
      record("sandbox.exec", w.exitCode === 0, w.stdout.trim().slice(0, 60));
      const [f, fms] = await timed(() => sb!.fork({ name: `delta-smoke-fork-${run}` }));
      fork = f;
      record("sandbox.fork", true, `${fork.id} ${fork.status}`, fms);
      await sb.exec("echo parent-changed > /workspace/state.txt");
      if (fork.status !== "running") await fork.start();
      const fr = await fork.exec("cat /workspace/state.txt");
      record("fork isolated from parent", fr.stdout.trim() === "base", `fork reads "${fr.stdout.trim()}"`);
    } catch (e) {
      record("sandbox create/fork", false, errText(e));
    } finally {
      for (const s of [fork, sb]) {
        if (!s) continue;
        try {
          await s.stop().catch(() => {});
          await s.delete();
        } catch (e) {
          console.log(`  note: cleanup of ${s.id} failed: ${errText(e)} (stop it in console.archil.com)`);
        }
      }
      if (sb) delete state.smokeSandboxId;
      saveState(state);
    }
  }
  finish(state);
}

function finish(state: Record<string, unknown>) {
  state.smoke = { at: new Date().toISOString(), results };
  saveState(state);
  const pass = results.filter((r) => r.ok === true).length;
  const fail = results.filter((r) => r.ok === false).length;
  console.log(`\n${pass} passed, ${fail} failed. State saved to ${STATE}${existsSync(STATE) ? "" : " (not written)"}.`);
}

main().catch((e) => {
  console.error("smoke test crashed:", errText(e));
  process.exit(1);
});
