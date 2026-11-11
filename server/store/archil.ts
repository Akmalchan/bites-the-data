// ArchilStore: every world is a directory on ONE Archil disk.
//   write/remove        -> S3 object API (putObject/deleteObject; not an exec call)
//   snapshot            -> 1 serverless exec: sha256 manifest + `archil checkpoints create`
//                          (a real, immutable whole-disk Archil checkpoint)
//   read at a snapshot  -> S3 GetObject with versionId=<checkpoint name>, content-addressed
//                          local cache so each unique blob is fetched once
//   fork                -> 1 exec: server-side `cp -a` on the disk (conditional mount)
// Budget per agent run (3 agents x ~7 steps): ~25 exec calls.
// Everything here was validated by scripts/archil-smoke.ts on the free plan.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as archil from "disk";
import type { WorldReader } from "../diff/engine.ts";
import type { Manifest } from "../diff/types.ts";
import { safeRel, type BackendInfo, type BashResult, type BranchResult, type RollbackResult, type SnapshotResult, type StoreStats, type WorldStore } from "./types.ts";

const STATE = resolve("data/archil-state.json");
const CACHE = resolve("data/cache");

type S3Raw = (m: string, k: string, o: unknown) => Promise<{ ok: boolean; status: number; body: Uint8Array }>;

interface Frozen {
  ref: string; // checkpoint name (reads use it as versionId)
  branch?: string; // set when this world is an Archil branch created from `ref`
  diskId?: string; // disk the checkpoint lives on (per-agent disks); main disk when absent
  dir: string; // run-prefixed directory the checkpointed world lived in
  manifest: Manifest;
}

function sha(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}

function loadState(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

export interface DiskMode {
  mode: "shared" | "per-agent" | "mixed";
  disks: number;
  ms: number;
  created: number;
  opened: number;
  note: string;
}

const MAX_AGENT_DISKS = Number(process.env.DELTA_MAX_AGENT_DISKS ?? 8);

export class ArchilStore implements WorldStore {
  private disk!: archil.Disk;
  private region = process.env.ARCHIL_REGION || "aws-us-west-2";
  private runId = "r0";
  private working = new Map<string, Manifest | null>();
  private agentDisks = new Map<string, archil.Disk>(); // agent key -> its own disk
  private diskCache = new Map<string, archil.Disk>();
  diskMode: DiskMode = { mode: "shared", disks: 1, ms: 0, created: 0, opened: 0, note: "all agents share one disk (folders per agent)" };
  private frozen = new Map<string, Frozen>();
  freshWorkspace = false;
  execCalls = 0;
  checkpoints = 0;
  branches = 0;
  bytesReadFromCheckpoints = 0;
  checkpointReads = 0;
  objectWrites = 0;
  bytesWritten = 0;

  stats(): StoreStats {
    return {
      execCalls: this.execCalls,
      checkpoints: this.checkpoints,
      branches: this.branches,
      bytesReadFromCheckpoints: this.bytesReadFromCheckpoints,
      checkpointReads: this.checkpointReads,
      objectWrites: this.objectWrites,
      bytesWritten: this.bytesWritten,
    };
  }

  info(): BackendInfo {
    return {
      kind: "archil",
      label: "Archil",
      detail: `${this.disk?.id ?? "disk pending"} · ${this.region}`,
      snapshotVerb: "Archil checkpoint",
      forkVerb: "server-side copy on the Archil disk",
    };
  }

  async init(): Promise<void> {
    archil.configure({ apiKey: process.env.ARCHIL_API_KEY, region: this.region });
    const state = loadState();
    const id = process.env.ARCHIL_DISK_ID || (state.diskId as string | undefined);
    // A cached id from another account (new API key) fails here; fall back to find-or-create by name.
    const byId = id ? await archil.getDisk(id).catch(() => undefined) : undefined;
    if (byId) this.disk = byId;
    else {
      if (id && !process.env.ARCHIL_DISK_ID) {
        // The cached disk belongs to a different workspace (new API key). Keep the old state as a backup and start fresh.
        const backup = STATE.replace(/\.json$/, `.old-${Date.now().toString(36)}.json`);
        if (existsSync(STATE)) writeFileSync(backup, readFileSync(STATE));
        writeFileSync(STATE, JSON.stringify({}, null, 2));
        this.freshWorkspace = true;
        console.warn(`Archil: cached disk ${id} is not visible to this API key; starting fresh (old state backed up to ${backup})`);
      }
      const found = (await archil.listDisks()).find((d) => (d as unknown as { name?: string }).name === "delta-worlds");
      this.disk = found ?? (await archil.createDisk({ name: "delta-worlds" })).disk;
      mkdirSync("data", { recursive: true });
      writeFileSync(STATE, JSON.stringify({ ...loadState(), diskId: this.disk.id, slotDisks: {} }, null, 2));
    }
    this.diskCache.set(this.disk.id, this.disk);
    if (!this.freshWorkspace && typeof state.runId === "string") this.runId = state.runId;
    mkdirSync(CACHE, { recursive: true });
  }

  private prefix(id: string): string {
    if (!/^[\w@.-]+$/.test(id)) throw new Error(`bad world id ${id}`);
    return `delta/${this.runId}/${id.replace("@", "-s")}`;
  }

  private async exec(command: string, disk: archil.Disk = this.disk): Promise<{ stdout: string; stderr: string; exitCode: number; ms: number }> {
    this.execCalls++;
    const t = performance.now();
    // Conditional mount: writes without a delegation checkout (shared mode is read-only for some paths).
    const r = await archil.exec({ disks: { w: { disk: disk.id, conditional: true } }, command: `cd /mnt/archil/w && ${command}` });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, ms: Math.round(performance.now() - t) };
  }

  /** Plain disk.exec: disk mounted at /mnt/archil (cwd). Used for checkpoints, which need that mountpoint. */
  private async execPlain(command: string, disk: archil.Disk = this.disk): Promise<{ stdout: string; stderr: string; exitCode: number; ms: number }> {
    this.execCalls++;
    const t = performance.now();
    const r = await disk.exec(command);
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, ms: Math.round(performance.now() - t) };
  }

  /** Agent key of a world id: _B, B@3, B@3.f1 -> B; S12@4 -> S12; base -> null. */
  private agentKey(id: string): string | null {
    if (id === "base" || id === "_base") return null;
    return id.match(/^_?([A-Za-z]+\d*)/)?.[1] ?? null;
  }

  private diskOf(id: string): archil.Disk {
    const k = this.agentKey(id);
    return (k && this.agentDisks.get(k)) || this.disk;
  }

  private async diskById(id?: string): Promise<archil.Disk> {
    if (!id) return this.disk;
    let d = this.diskCache.get(id);
    if (!d) {
      d = await archil.getDisk(id);
      this.diskCache.set(id, d);
    }
    return d;
  }

  /**
   * One disk per agent, reused across runs by slot name (delta-agent-1..N), ids cached in data/archil-state.json.
   * Any limit error falls back to the shared disk for the remaining agents, and says so.
   */
  async prepareAgents(keys: string[]): Promise<DiskMode> {
    this.agentDisks.clear();
    const t = performance.now();
    if (process.env.DELTA_DISK_PER_AGENT === "0") {
      this.diskMode = { mode: "shared", disks: 1, ms: 0, created: 0, opened: 0, note: "per-agent disks turned off (DELTA_DISK_PER_AGENT=0); agents share one disk" };
      return this.diskMode;
    }
    const state = loadState();
    const slots = (state.slotDisks ?? {}) as Record<string, string>;
    let created = 0;
    let opened = 0;
    let note = "";
    const n0 = Math.min(keys.length, MAX_AGENT_DISKS);
    if (keys.length > MAX_AGENT_DISKS) note = `${keys.length - MAX_AGENT_DISKS} agents beyond ${MAX_AGENT_DISKS} share the main disk`;
    const listed = await archil.listDisks().catch(() => [] as archil.Disk[]);
    // Open or create all slot disks in parallel; any failure (e.g. plan disk limit) leaves that agent on the main disk.
    const results = await Promise.all(
      Array.from({ length: n0 }, async (_, i) => {
        const slot = `delta-agent-${i + 1}`;
        try {
          let d = slots[slot] ? await archil.getDisk(slots[slot]).catch(() => undefined) : undefined;
          d ??= listed.find((x) => (x as unknown as { name?: string }).name === slot);
          let made = false;
          if (!d) {
            d = (await archil.createDisk({ name: slot })).disk;
            made = true;
          }
          return { i, slot, d, made };
        } catch (e) {
          return { i, slot, err: String((e as Error).message).slice(0, 80) };
        }
      }),
    );
    for (const r of results) {
      if ("d" in r && r.d) {
        slots[r.slot] = r.d.id;
        this.agentDisks.set(keys[r.i], r.d);
        this.diskCache.set(r.d.id, r.d);
        if (r.made) created++;
        else opened++;
      } else if ("err" in r && !note) note = `could not get disk ${r.slot} (${r.err}); those agents share the main disk`;
    }
    writeFileSync(STATE, JSON.stringify({ ...loadState(), slotDisks: slots }, null, 2));
    const n = this.agentDisks.size;
    const ms = Math.round(performance.now() - t);
    this.diskMode = {
      mode: n === 0 ? "shared" : n === keys.length ? "per-agent" : "mixed",
      disks: n + (n < keys.length ? 1 : 0),
      ms, created, opened,
      note: note || (n === keys.length ? `one disk per agent: ${opened} opened, ${created} created in ${ms} ms` : "all agents share one disk"),
    };
    return this.diskMode;
  }

  private cacheGet(hash: string): Buffer | null {
    const p = join(CACHE, hash);
    return existsSync(p) ? readFileSync(p) : null;
  }

  private cachePut(data: Buffer): string {
    const h = sha(data);
    const p = join(CACHE, h);
    if (!existsSync(p)) writeFileSync(p, data);
    return h;
  }

  async reset(runId: string): Promise<void> {
    this.runId = runId;
    this.working.clear();
    this.frozen.clear();
    writeFileSync(STATE, JSON.stringify({ ...loadState(), runId }, null, 2));
    // Old run directories are dead weight on a 10 GB free disk; checkpoints keep their own copies.
    await this.exec("rm -rf delta && mkdir -p delta");
  }

  async create(id: string, files: Record<string, Buffer | string>): Promise<void> {
    this.working.set(id, {});
    await Promise.all(Object.entries(files).map(([p, d]) => this.write(id, p, d)));
  }

  async fork(srcId: string, dstId: string) {
    const src = this.diskOf(srcId);
    const dst = this.diskOf(dstId);
    let r;
    if (src.id === dst.id) {
      r = await this.exec(`rm -rf ${this.prefix(dstId)} && cp -a ${this.prefix(srcId)} ${this.prefix(dstId)}`, dst);
    } else {
      // Cross-disk fork: mount both disks in ONE serverless exec and copy server-side.
      this.execCalls++;
      const t = performance.now();
      const parent = this.prefix(dstId).split("/").slice(0, -1).join("/");
      const x = await archil.exec({
        disks: { src: { disk: src.id, readOnly: true }, dst: { disk: dst.id, conditional: true } },
        command: `rm -rf /mnt/archil/dst/delta && mkdir -p /mnt/archil/dst/${parent} && cp -a /mnt/archil/src/${this.prefix(srcId)} /mnt/archil/dst/${this.prefix(dstId)}`,
      });
      r = { stdout: x.stdout, stderr: x.stderr, exitCode: x.exitCode, ms: Math.round(performance.now() - t) };
    }
    if (r.exitCode !== 0) throw new Error(`archil fork failed: ${r.stderr.slice(0, 200)}`);
    const srcManifest = this.working.get(srcId);
    this.working.set(dstId, srcManifest ? { ...srcManifest } : null);
    return { ms: r.ms };
  }

  async snapshot(workId: string, snapId: string): Promise<SnapshotResult> {
    const ref = `d-${this.runId}-${snapId.replace("@", "-s")}`.slice(0, 100);
    const dir = this.prefix(workId);
    const disk = this.diskOf(workId);
    const r = await this.execPlain(
      `cd /mnt/archil/${dir} && find . -type f -print0 | xargs -0 -r sha256sum; echo '---SIZES---'; find . -type f -printf '%s %P\\n'; ` +
        `echo '---CP---'; sync; archil checkpoints create /mnt/archil ${ref} 2>&1; echo "CP_EXIT=$?"`,
      disk,
    );
    if (!/CP_EXIT=0/.test(r.stdout)) throw new Error(`archil checkpoint failed: ${(r.stdout + r.stderr).slice(-300)}`);
    this.checkpoints++;
    if (!r.stdout.includes("---SIZES---")) throw new Error(`unexpected snapshot output: ${r.stdout.slice(0, 200)}`);
    const [hashes, rest] = r.stdout.split("---SIZES---");
    const [sizes] = rest.split("---CP---");
    const manifest: Manifest = {};
    for (const line of hashes.trim().split("\n").filter(Boolean)) {
      const m = line.match(/^([0-9a-f]{64})\s+\*?(?:\.\/)?(.+)$/);
      if (m) manifest[m[2]] = { path: m[2], hash: m[1], size: 0 };
    }
    for (const line of sizes.trim().split("\n").filter(Boolean)) {
      const i = line.indexOf(" ");
      const p = line.slice(i + 1);
      if (manifest[p]) manifest[p].size = Number(line.slice(0, i));
    }
    if (Object.keys(manifest).length === 0 && sizes.trim()) throw new Error(`could not parse manifest: ${hashes.slice(0, 200)}`);
    this.frozen.set(snapId, { ref, dir, manifest, diskId: disk.id === this.disk.id ? undefined : disk.id });
    // Server truth wins over our client-side view. Copy: later writes must not mutate the frozen manifest.
    this.working.set(workId, { ...manifest });
    return { ms: r.ms, manifest, ref };
  }

  /** Real Archil branch from the snapshot's checkpoint. Its starting content is the checkpoint, so Delta reads it through the same versionId. */
  async branch(snapId: string, newId: string): Promise<BranchResult> {
    const f = this.frozen.get(snapId);
    if (!f) throw new Error(`${snapId} is not a checkpoint`);
    const name = `d-${this.runId}-${newId.replace(/[^\w-]/g, "-")}`.slice(0, 100);
    const t = performance.now();
    for (let attempt = 0; ; attempt++) {
      try {
        await (await this.diskById(f.diskId)).createBranch({ name, fromCheckpoint: f.ref });
        break;
      } catch (e) {
        // 409 while the checkpoint is still committing; retry briefly.
        if (attempt >= 12 || !/409|not yet committed|conflict/i.test(String((e as Error).message))) throw e;
        await new Promise((r) => setTimeout(r, 750));
      }
    }
    const ms = Math.round(performance.now() - t);
    this.branches++;
    this.frozen.set(newId, { ...f, branch: name });
    return { ms, ref: name, manifest: f.manifest };
  }

  /** Roll back: branch from the checkpoint (the durable restore point), then bring Delta's live dir back via the object API. */
  async rollback(workId: string, snapId: string): Promise<RollbackResult> {
    const f = this.frozen.get(snapId);
    if (!f) throw new Error(`${snapId} is not a checkpoint`);
    const rbId = `${snapId}-rb${Date.now().toString(36).slice(-4)}`;
    const b = await this.branch(snapId, rbId);
    this.frozen.delete(rbId); // the branch is the durable restore point; Delta keeps no extra world for it
    const t = performance.now();
    const current = (await this.reader(workId).manifest()) ?? {};
    const target = f.manifest;
    const changed = Object.values(target).filter((e) => current[e.path]?.hash !== e.hash);
    const extra = Object.keys(current).filter((p) => !target[p]);
    await Promise.all(changed.map(async (e) => this.write(workId, e.path, await this.readAt(f, e.path))));
    await Promise.all(extra.map((p) => this.remove(workId, p)));
    this.working.set(workId, { ...target });
    return { ms: b.ms, restoreMs: Math.round(performance.now() - t), ref: b.ref, written: changed.length, removed: extra.length };
  }

  async discard(id: string): Promise<void> {
    this.working.delete(id);
  }

  restore(snapId: string, meta: { ref?: string; manifest?: Manifest; dir?: string; branch?: string; diskId?: string }): void {
    if (meta.ref && meta.manifest && meta.dir) this.frozen.set(snapId, { ref: meta.ref, manifest: meta.manifest, dir: meta.dir, branch: meta.branch, diskId: meta.diskId });
  }

  frozenMeta(snapId: string) {
    return this.frozen.get(snapId);
  }

  /** Read a file as of an Archil checkpoint. A fresh checkpoint can take a few seconds to become readable. */
  private async readAt(f: Frozen, path: string): Promise<Buffer> {
    const entry = f.manifest[path];
    if (!entry) throw new Error(`${path} not in checkpoint ${f.ref}`);
    const hit = this.cacheGet(entry.hash);
    if (hit) return hit;
    const disk = await this.diskById(f.diskId);
    const s3 = ((disk as unknown as { _s3Request: S3Raw })._s3Request).bind(disk);
    const key = `${f.dir}/${path}`;
    const deadline = Date.now() + 45_000;
    for (let attempt = 0; ; attempt++) {
      const r = await s3("GET", key, { query: { versionId: f.ref } });
      if (r.ok) {
        const buf = Buffer.from(r.body);
        this.checkpointReads++;
        this.bytesReadFromCheckpoints += buf.length;
        if (sha(buf) === entry.hash) {
          this.cachePut(buf);
          return buf;
        }
        throw new Error(`checkpoint read hash mismatch for ${path}`);
      }
      if (r.status !== 503 || Date.now() > deadline) {
        // Last resort: the live object may still hold identical bytes.
        const head = Buffer.from(await disk.getObject(key).catch(() => new Uint8Array()));
        if (head.length && sha(head) === entry.hash) return Buffer.from(head);
        throw new Error(`cannot read ${path} at ${f.ref}: HTTP ${r.status}`);
      }
      await new Promise((res) => setTimeout(res, Math.min(500 * 2 ** attempt, 3000)));
    }
  }

  reader(id: string): WorldReader {
    const f = this.frozen.get(id);
    if (f) {
      return { manifest: async () => f.manifest, read: (p) => this.readAt(f, safeRel(p)) };
    }
    return {
      manifest: async () => {
        const m = this.working.get(id);
        if (m) return m;
        const r = await this.execPlain(`cd /mnt/archil/${this.prefix(id)} && find . -type f -print0 | xargs -0 -r sha256sum`, this.diskOf(id));
        const out: Manifest = {};
        for (const line of r.stdout.trim().split("\n").filter(Boolean)) {
          const mm = line.match(/^([0-9a-f]{64})\s+\*?(?:\.\/)?(.+)$/);
          if (mm) out[mm[2]] = { path: mm[2], hash: mm[1], size: 0 };
        }
        this.working.set(id, out);
        return out;
      },
      read: async (p) => {
        const rel = safeRel(p);
        const known = this.working.get(id)?.[rel];
        const hit = known ? this.cacheGet(known.hash) : null;
        if (hit) return hit;
        const buf = Buffer.from(await this.diskOf(id).getObject(`${this.prefix(id)}/${rel}`));
        this.cachePut(buf);
        return buf;
      },
    };
  }

  async write(id: string, path: string, data: Buffer | string): Promise<void> {
    const rel = safeRel(path);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await this.diskOf(id).putObject(`${this.prefix(id)}/${rel}`, buf);
    this.objectWrites++;
    this.bytesWritten += buf.length;
    const h = this.cachePut(buf);
    const m = this.working.get(id);
    if (m) m[rel] = { path: rel, hash: h, size: buf.length };
  }

  async remove(id: string, path: string): Promise<void> {
    const rel = safeRel(path);
    await this.diskOf(id).deleteObject(`${this.prefix(id)}/${rel}`);
    const m = this.working.get(id);
    if (m) delete m[rel];
  }

  async bash(id: string, command: string): Promise<BashResult> {
    const r = await this.exec(`cd ${this.prefix(id)} && ${command}`, this.diskOf(id));
    this.working.set(id, null); // unknown until next manifest/snapshot
    return { stdout: r.stdout.slice(-20000), stderr: r.stderr.slice(-8000), exitCode: r.exitCode, ms: r.ms };
  }
}
