import type { FileReport, RuleHit } from "./analyze.ts";
import type { PrMeta } from "./github.ts";

export interface ArchilInfo {
  ok: boolean;
  disk?: string;
  diskId?: string;
  region?: string;
  baseRef?: string;
  headRef?: string;
  branch?: string;
  execCalls: number;
  createExecCalls?: number; // exec calls spent creating these checkpoints (first run)
  objectWrites: number;
  checkpointReads: number;
  bytesRead: number;
  reused: boolean;
  hashVerified: boolean;
  ms: number;
  note?: string;
}

export interface GitLine {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  data: boolean;
}

export interface Report {
  repo: string;
  pr: PrMeta;
  generatedAt: string;
  files: FileReport[];
  hits: RuleHit[];
  git: GitLine[];
  archil: ArchilInfo;
  verdict: { level: "warn" | "ok"; parts: string[]; text: string };
  reportUrl: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function verdictOf(hits: RuleHit[]): Report["verdict"] {
  const c = (r: RuleHit["rule"]) => hits.filter((h) => h.rule === r).length;
  const parts: string[] = [];
  if (c("price")) parts.push(`${plural(c("price"), "suspicious price change")}`);
  if (c("removed")) parts.push(`${plural(c("removed"), "product")} removed`);
  if (c("fitment")) parts.push(`fitment lost on ${plural(c("fitment"), "product")}`);
  if (c("stock")) parts.push(`${plural(c("stock"), "SKU")} set to 0 stock`);
  if (!parts.length) return { level: "ok", parts: [], text: "No risky data changes found" };
  return { level: "warn", parts, text: parts.join(" · ") };
}
