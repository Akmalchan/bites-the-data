// Minimal Archil path for PR checks. Same calls the delta ArchilStore makes
// (object API writes, one exec per checkpoint, versionId reads), but with its
// own disk and its own state file so it never touches the app's worlds.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as archil from "disk";
import { PRCHECK_DIR } from "./paths.ts";

const STATE = `${PRCHECK_DIR}/state.json`;
const DISK_NAME = "bites-geargo";

type S3Raw = (m: string, k: string, o: unknown) => Promise<{ ok: boolean; status: number; body: Uint8Array }>;

export interface State {
  diskId?: string;
  diskName?: string;
  prs?: Record<string, PrState>;
}

export interface PrState {
  baseSha: string;
  headSha: string;
  dir: string;
  baseRef: string;
  headRef: string;
  branch?: string;
  execCalls?: number;
  commentId?: number;
  commentUrl?: string;
}

export function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

export function saveState(s: State): void {
  writeFileSync(STATE, JSON.stringify(s, null, 2));
}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export class PrArchil {
  disk!: archil.Disk;
  region = process.env.ARCHIL_REGION || "aws-us-west-2";
  execCalls = 0;
  objectWrites = 0;
  checkpointReads = 0;
  bytesRead = 0;
  diskNote = "";

  async init(): Promise<void> {
    if (!process.env.ARCHIL_API_KEY) throw new Error("ARCHIL_API_KEY not set");
    archil.configure({ apiKey: process.env.ARCHIL_API_KEY, region: this.region });
    const st = loadState();
    let d = st.diskId ? await archil.getDisk(st.diskId).catch(() => undefined) : undefined;
    if (!d) {
      const listed = await archil.listDisks();
      const name = (x: archil.Disk) => (x as unknown as { name?: string }).name;
      d = listed.find((x) => name(x) === DISK_NAME);
      if (!d) {
        try {
          d = (await archil.createDisk({ name: DISK_NAME })).disk;
        } catch (e) {
          // Plan disk limit: share the app's main disk, in our own folder.
          d = listed.find((x) => name(x) === "delta-worlds");
          if (!d) throw e;
          this.diskNote = `could not create ${DISK_NAME} (${String((e as Error).message).slice(0, 60)}); using delta-worlds`;
        }
      }
      st.diskId = d.id;
      st.diskName = name(d) ?? DISK_NAME;
      saveState(st);
    }
    this.disk = d;
  }

  get diskName(): string {
    return loadState().diskName ?? DISK_NAME;
  }

  async write(key: string, data: Buffer): Promise<void> {
    await this.disk.putObject(key, data);
    this.objectWrites++;
  }

  async remove(key: string): Promise<void> {
    await this.disk.deleteObject(key).catch(() => undefined);
  }

  /** One exec: hash every file in `dir` (server-side manifest) and take a whole-disk checkpoint. */
  async checkpoint(dir: string, name: string): Promise<{ ms: number; hashes: Record<string, string> }> {
    this.execCalls++;
    const t = performance.now();
    const r = await this.disk.exec(
      `cd /mnt/archil/${dir} && find . -type f -print0 | xargs -0 -r sha256sum; echo '---CP---'; sync; archil checkpoints create /mnt/archil ${name} 2>&1; echo "CP_EXIT=$?"`,
    );
    const ms = Math.round(performance.now() - t);
    if (!/CP_EXIT=0/.test(r.stdout)) throw new Error(`checkpoint ${name} failed: ${(r.stdout + r.stderr).slice(-300)}`);
    const hashes: Record<string, string> = {};
    for (const line of r.stdout.split("---CP---")[0].trim().split("\n").filter(Boolean)) {
      const m = line.match(/^([0-9a-f]{64})\s+\*?(?:\.\/)?(.+)$/);
      if (m) hashes[m[2]] = m[1];
    }
    return { ms, hashes };
  }

  /** Read an object as of a checkpoint (S3 GetObject with versionId). Fresh checkpoints 503 for a few seconds. */
  async readAt(key: string, ref: string, expectHash: string): Promise<Buffer> {
    const s3 = ((this.disk as unknown as { _s3Request: S3Raw })._s3Request).bind(this.disk);
    const deadline = Date.now() + 60_000;
    for (let attempt = 0; ; attempt++) {
      const r = await s3("GET", key, { query: { versionId: ref } });
      if (r.ok) {
        const buf = Buffer.from(r.body);
        if (sha256(buf) !== expectHash) throw new Error(`hash mismatch reading ${key} at ${ref}`);
        this.checkpointReads++;
        this.bytesRead += buf.length;
        return buf;
      }
      if (r.status !== 503 || Date.now() > deadline) throw new Error(`cannot read ${key} at ${ref}: HTTP ${r.status}`);
      await new Promise((res) => setTimeout(res, Math.min(500 * 2 ** attempt, 3000)));
    }
  }

  async branch(name: string, fromCheckpoint: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.disk.createBranch({ name, fromCheckpoint });
        return name;
      } catch (e) {
        const msg = String((e as Error).message);
        if (/exist|duplicate/i.test(msg) && !/not yet/i.test(msg)) return name; // already there from an earlier run
        if (attempt >= 12 || !/409|not yet committed|conflict/i.test(msg)) throw e;
        await new Promise((r) => setTimeout(r, 750));
      }
    }
  }
}

export { existsSync };
