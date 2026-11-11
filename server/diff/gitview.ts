// "What would git show?" Runs the real `git diff --no-index --numstat` on the two
// versions of a file, so the comparison in the UI is honest, not simulated.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorldReader } from "./engine.ts";
import type { FileChange, GitView } from "./types.ts";

const dir = join(tmpdir(), "delta-git");

async function materialize(r: WorldReader, path: string, hash: string): Promise<string> {
  const local = r.localPath?.(path);
  if (local && existsSync(local)) return local;
  mkdirSync(dir, { recursive: true });
  const p = join(dir, hash);
  if (!existsSync(p)) writeFileSync(p, await r.read(path));
  return p;
}

export async function gitView(a: WorldReader, b: WorldReader, fc: FileChange): Promise<GitView> {
  if (fc.status === "renamed") return { added: 0, removed: 0, binary: false, text: `rename ${fc.oldPath} => ${fc.path} (only if git's rename detection is on)` };
  const pa = fc.status === "added" ? "/dev/null" : await materialize(a, fc.oldPath ?? fc.path, fc.hashBefore!);
  const pb = fc.status === "removed" ? "/dev/null" : await materialize(b, fc.path, fc.hashAfter!);
  const r = spawnSync("git", ["diff", "--no-index", "--numstat", "--", pa, pb], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const line = (r.stdout ?? "").trim().split("\n")[0] ?? "";
  const [add, del] = line.split("\t");
  if (add === "-" && del === "-") return { added: null, removed: null, binary: true, text: `Binary files a/${fc.path} and b/${fc.path} differ` };
  const added = Number(add) || 0;
  const removed = Number(del) || 0;
  return { added, removed, binary: false, text: `${fc.path} | +${added.toLocaleString("en-US")} −${removed.toLocaleString("en-US")} lines` };
}
