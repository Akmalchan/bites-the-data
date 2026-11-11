// LocalStore: each world is a directory. Forks and snapshots are APFS clones
// (`cp -c`, copy-on-write, near-instant) with a plain-copy fallback elsewhere.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { WorldReader } from "../diff/engine.ts";
import type { Manifest } from "../diff/types.ts";
import { safeRel, type BackendInfo, type BashResult, type BranchResult, type RollbackResult, type SnapshotResult, type WorldStore } from "./types.ts";

export async function hashFile(path: string): Promise<string> {
  const st = statSync(path);
  if (st.size < 8 * 1024 * 1024) return createHash("sha256").update(await readFile(path)).digest("hex");
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (c) => h.update(c))
      .on("end", () => res(h.digest("hex")))
      .on("error", rej);
  });
}

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(root, p, out);
    else if (e.isFile()) out.push(relative(root, p).split("\\").join("/"));
  }
  return out;
}

export async function manifestOfDir(root: string): Promise<Manifest> {
  const m: Manifest = {};
  if (!existsSync(root)) return m;
  const files = walk(root);
  await Promise.all(
    files.map(async (rel) => {
      const abs = join(root, rel);
      m[rel] = { path: rel, size: statSync(abs).size, hash: await hashFile(abs) };
    }),
  );
  return m;
}

export class LocalStore implements WorldStore {
  readonly root: string;
  private cloneSupported: boolean | null = null;
  private frozen = new Map<string, Manifest>();

  constructor(root = resolve("data/local/worlds")) {
    this.root = root;
  }

  info(): BackendInfo {
    return {
      kind: "local",
      label: "Local",
      detail: this.cloneSupported ? "APFS copy-on-write clones" : "directory copies",
      snapshotVerb: this.cloneSupported ? "APFS clone" : "copy",
      forkVerb: this.cloneSupported ? "APFS clone" : "copy",
    };
  }

  async init(): Promise<void> {
    mkdirSync(this.root, { recursive: true });
    if (this.cloneSupported === null) {
      const probe = join(this.root, ".probe");
      await writeFile(probe, "x");
      const r = spawnSync("cp", ["-c", probe, probe + "2"]);
      this.cloneSupported = r.status === 0;
      rmSync(probe, { force: true });
      rmSync(probe + "2", { force: true });
    }
  }

  dir(id: string): string {
    if (!/^[\w@.-]+$/.test(id)) throw new Error(`bad world id ${id}`);
    return join(this.root, id);
  }

  async reset(): Promise<void> {
    rmSync(this.root, { recursive: true, force: true });
    this.frozen.clear();
    await this.init();
  }

  async create(id: string, files: Record<string, Buffer | string>): Promise<void> {
    const d = this.dir(id);
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
    for (const [p, data] of Object.entries(files)) await this.write(id, p, data);
  }

  private clone(src: string, dst: string): number {
    rmSync(dst, { recursive: true, force: true });
    const t = performance.now();
    const args = this.cloneSupported ? ["-c", "-R", src, dst] : ["-R", src, dst];
    const r = spawnSync("cp", args);
    if (r.status !== 0) {
      const r2 = spawnSync("cp", ["-R", src, dst]);
      if (r2.status !== 0) throw new Error(`copy failed: ${r2.stderr}`);
    }
    return Math.round((performance.now() - t) * 10) / 10;
  }

  async fork(srcId: string, dstId: string) {
    return { ms: this.clone(this.dir(srcId), this.dir(dstId)) };
  }

  async snapshot(workId: string, snapId: string): Promise<SnapshotResult> {
    const ms = this.clone(this.dir(workId), this.dir(snapId));
    const manifest = await manifestOfDir(this.dir(snapId));
    this.frozen.set(snapId, manifest);
    return { ms, manifest };
  }

  async branch(snapId: string, newId: string): Promise<BranchResult> {
    const ms = this.clone(this.dir(snapId), this.dir(newId));
    const manifest = this.frozen.get(snapId) ?? (await manifestOfDir(this.dir(newId)));
    this.frozen.set(newId, manifest);
    return { ms, manifest };
  }

  async rollback(workId: string, snapId: string): Promise<RollbackResult> {
    const before = await manifestOfDir(this.dir(workId));
    const target = this.frozen.get(snapId) ?? (await manifestOfDir(this.dir(snapId)));
    const ms = this.clone(this.dir(snapId), this.dir(workId));
    const written = Object.values(target).filter((e) => before[e.path]?.hash !== e.hash).length;
    const removed = Object.keys(before).filter((p) => !target[p]).length;
    return { ms, restoreMs: ms, written, removed };
  }

  async discard(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
  }

  restore(snapId: string, meta: { manifest?: Manifest }): void {
    if (meta.manifest) this.frozen.set(snapId, meta.manifest);
  }

  frozenMeta(snapId: string) {
    const m = this.frozen.get(snapId);
    return m ? { manifest: m } : undefined;
  }

  reader(id: string): WorldReader {
    const d = this.dir(id);
    return {
      manifest: async () => this.frozen.get(id) ?? manifestOfDir(d),
      read: (p: string) => readFile(join(d, safeRel(p))),
      localPath: (p: string) => join(d, safeRel(p)),
    };
  }

  async write(id: string, path: string, data: Buffer | string): Promise<void> {
    const abs = join(this.dir(id), safeRel(path));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, data);
  }

  async remove(id: string, path: string): Promise<void> {
    await rm(join(this.dir(id), safeRel(path)), { force: true });
  }

  bash(id: string, command: string, timeoutMs = 30_000): Promise<BashResult> {
    const t = performance.now();
    return new Promise((res) => {
      const child = spawn("bash", ["-c", command], {
        cwd: this.dir(id),
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: this.dir(id), LANG: "C.UTF-8" },
        timeout: timeoutMs,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) =>
        res({ stdout: stdout.slice(-20000), stderr: stderr.slice(-8000), exitCode: code ?? -1, ms: Math.round(performance.now() - t) }),
      );
    });
  }
}
