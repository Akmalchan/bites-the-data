// Thin wrappers over the `gh` CLI (uses the reviewer's own gh auth).
import { execFile, execFileSync } from "node:child_process";

export function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, input, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
}

export function ghBuf(args: string[]): Buffer {
  return execFileSync("gh", args, { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export interface PrMeta {
  number: number;
  title: string;
  url: string;
  author: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  additions: number;
  deletions: number;
}

export interface PrFile {
  path: string;
  previousPath?: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
}

export function prMeta(repo: string, n: number): PrMeta {
  const j = JSON.parse(gh(["api", `repos/${repo}/pulls/${n}`]));
  return {
    number: j.number,
    title: j.title,
    url: j.html_url,
    author: j.user?.login ?? "unknown",
    baseRef: j.base.ref,
    headRef: j.head.ref,
    baseSha: j.base.sha,
    headSha: j.head.sha,
    additions: j.additions,
    deletions: j.deletions,
  };
}

export function prFiles(repo: string, n: number): PrFile[] {
  const pages = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/pulls/${n}/files?per_page=100`])) as unknown[][];
  return pages.flat().map((f) => {
    const x = f as Record<string, unknown>;
    return {
      path: String(x.filename),
      previousPath: x.previous_filename ? String(x.previous_filename) : undefined,
      status: x.status as PrFile["status"],
      additions: Number(x.additions ?? 0),
      deletions: Number(x.deletions ?? 0),
    };
  });
}

/** Raw file bytes at a commit (blob API handles files over the 1 MB contents limit). */
export function fileAt(repo: string, path: string, sha: string): Promise<Buffer> {
  const enc = path.split("/").map(encodeURIComponent).join("/");
  return new Promise((res, rej) =>
    execFile("gh", ["api", "-H", "Accept: application/vnd.github.raw", `repos/${repo}/contents/${enc}?ref=${sha}`], { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }, (e, out) => (e ? rej(e) : res(out))),
  );
}

export interface PostedComment {
  id: number;
  url: string;
  updated: boolean;
}

/** Post once; later runs PATCH the same comment (id kept in state.json). Never deletes. */
export function upsertComment(repo: string, n: number, body: string, existingId?: number): PostedComment {
  if (existingId) {
    try {
      const j = JSON.parse(gh(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${existingId}`, "--input", "-"], JSON.stringify({ body })));
      return { id: j.id, url: j.html_url, updated: true };
    } catch {
      // comment gone (deleted by a human): fall through and post a new one
    }
  }
  const j = JSON.parse(gh(["api", "-X", "POST", `repos/${repo}/issues/${n}/comments`, "--input", "-"], JSON.stringify({ body })));
  return { id: j.id, url: j.html_url, updated: false };
}
