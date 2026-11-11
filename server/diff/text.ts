import { structuredPatch } from "diff";
import type { TextDiff } from "./types.ts";

const MAX_HUNK_LINES = 4000;

export function diffText(name: string, before: string, after: string): TextDiff {
  const patch = structuredPatch(name, name, before, after, "", "", { context: 3 });
  let linesAdded = 0;
  let linesRemoved = 0;
  let emitted = 0;
  let truncated = false;
  const hunks = [];
  for (const h of patch.hunks) {
    for (const l of h.lines) {
      if (l.startsWith("+")) linesAdded++;
      else if (l.startsWith("-")) linesRemoved++;
    }
    if (emitted < MAX_HUNK_LINES) {
      hunks.push({ oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, lines: h.lines });
      emitted += h.lines.length;
    } else truncated = true;
  }
  return { type: "text", hunks, linesAdded, linesRemoved, truncated };
}
