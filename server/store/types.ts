import type { WorldReader } from "../diff/engine.ts";
import type { Manifest } from "../diff/types.ts";

export interface BackendInfo {
  kind: "local" | "archil";
  label: string; // e.g. "Local · APFS clones" / "Archil · aws-us-west-2"
  detail: string; // disk id, root dir
  snapshotVerb: string; // what a checkpoint physically is on this backend
  forkVerb: string;
}

export interface SnapshotResult {
  ms: number;
  manifest: Manifest;
  ref?: string; // backend reference (Archil checkpoint name)
}

export interface BranchResult {
  ms: number;
  ref?: string; // Archil branch name
  manifest: Manifest;
}

export interface RollbackResult {
  ms: number; // time to create the restore point (Archil branch / APFS clone)
  restoreMs: number; // time to bring the live working world back
  ref?: string;
  written: number;
  removed: number;
}

export interface StoreStats {
  execCalls: number;
  checkpoints: number;
  branches: number;
  bytesReadFromCheckpoints: number;
  checkpointReads: number;
  objectWrites: number;
  bytesWritten: number;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
}

/**
 * Where worlds physically live. A "world" is a whole directory tree an agent
 * works in. Working worlds are writable; snapshots are frozen.
 */
export interface WorldStore {
  info(): BackendInfo;
  init(): Promise<void>;
  /** Drop every world (new seed). */
  reset(runId: string): Promise<void>;
  /** Create a writable world from scratch. */
  create(id: string, files: Record<string, Buffer | string>): Promise<void>;
  /** Writable copy of `src` (an agent's fork of the base world). */
  fork(srcId: string, dstId: string): Promise<{ ms: number }>;
  /** Frozen checkpoint of a working world. */
  snapshot(workId: string, snapId: string): Promise<SnapshotResult>;
  /** New frozen world identical to `snapId` (Archil: a real branch from the checkpoint). */
  branch(snapId: string, newId: string): Promise<BranchResult>;
  /** Make a working world identical to a snapshot again (roll back). */
  rollback(workId: string, snapId: string): Promise<RollbackResult>;
  /** Drop a working world (snapshots remain). */
  discard(id: string): Promise<void>;
  reader(id: string): WorldReader;
  write(id: string, path: string, data: Buffer | string): Promise<void>;
  remove(id: string, path: string): Promise<void>;
  bash(id: string, command: string, timeoutMs?: number): Promise<BashResult>;
  /** Re-register frozen-world metadata loaded from disk after a restart. */
  restore?(snapId: string, meta: { ref?: string; manifest?: Manifest; dir?: string }): void;
  /** Metadata needed to restore a frozen world later. */
  frozenMeta?(snapId: string): { ref?: string; manifest?: Manifest; dir?: string } | undefined;
}

export function safeRel(path: string): string {
  const p = path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (p === "" || p.split("/").some((s) => s === ".." || s === "")) throw new Error(`unsafe path: ${path}`);
  return p;
}
