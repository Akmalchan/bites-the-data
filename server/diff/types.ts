// Shared types for the Delta diff engine. Everything here is plain JSON so it
// can be sent to the UI unchanged.

export interface ManifestEntry {
  path: string;
  size: number;
  hash: string; // sha256 hex
}

/** path -> entry. Paths are POSIX, relative to the world root, no leading "./". */
export type Manifest = Record<string, ManifestEntry>;

export type FileKind = "csv" | "sqlite" | "json" | "text" | "binary";
export type ChangeStatus = "added" | "removed" | "modified" | "renamed";

export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export interface Flag {
  level: "warn" | "info";
  text: string;
}

export interface CellChange {
  before: Cell;
  after: Cell;
}

export interface ChangedRow {
  key: string;
  cells: Record<string, CellChange>;
  row: Row; // full "after" row for context
}

export interface MagnitudeShift {
  column: string;
  count: number;
  medianFactor: number; // after / before
}

export interface TwinAnalysis {
  column: string; // natural-key column used to look for a surviving twin
  matched: number; // removed rows whose value still exists on the other side (merged)
  unmatched: number; // removed rows with no surviving twin (data loss)
  unmatchedKeys: string[]; // capped
}

export interface TableDiff {
  name: string;
  key: string[];
  keySource: "declared" | "detected" | "rowid" | "rowhash";
  columns: string[]; // union, "after" order first
  columnsAdded: string[];
  columnsRemoved: string[];
  rowsBefore: number;
  rowsAfter: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  cellsChanged: number;
  cellsFilled: number; // empty -> value
  cellsCleared: number; // value -> empty
  columnChangeCounts: Record<string, number>;
  added: Row[];
  removed: Row[];
  changed: ChangedRow[];
  truncated: boolean;
  twins?: TwinAnalysis;
  magnitude: MagnitudeShift[];
  status?: "added" | "removed" | "modified" | "unchanged";
  schemaBefore?: string;
  schemaAfter?: string;
}

export interface SqliteDiff {
  type: "sqlite";
  tables: TableDiff[];
  tablesAdded: string[];
  tablesRemoved: string[];
  bytesOnlyChange: boolean; // bytes differ but no logical change (e.g. VACUUM)
}

export interface CsvDiff {
  type: "csv";
  table: TableDiff;
}

export interface JsonChange {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

export interface JsonDiff {
  type: "json";
  changes: JsonChange[];
  total: number;
  truncated: boolean;
  parseError?: string;
}

export interface TextHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[]; // prefixed with " ", "+", "-"
}

export interface TextDiff {
  type: "text";
  hunks: TextHunk[];
  linesAdded: number;
  linesRemoved: number;
  truncated: boolean;
}

export interface BinaryDiff {
  type: "binary";
  sizeBefore?: number;
  sizeAfter?: number;
  hashBefore?: string;
  hashAfter?: string;
  note?: string;
}

export type FileDetail = CsvDiff | SqliteDiff | JsonDiff | TextDiff | BinaryDiff;

export interface FileStats {
  rowsAdded?: number;
  rowsRemoved?: number;
  rowsChanged?: number;
  cellsChanged?: number;
  columnsAdded?: number;
  columnsRemoved?: number;
  tablesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
  pathsChanged?: number;
  rowsBefore?: number;
  rowsAfter?: number;
  rowsLost?: number; // removed rows with no surviving natural-key twin
  cellsFilled?: number;
  magnitudeShifts?: number;
}

export interface FileChange {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  kind: FileKind;
  sizeBefore?: number;
  sizeAfter?: number;
  hashBefore?: string;
  hashAfter?: string;
  stats: FileStats;
  flags: Flag[];
  summary: string; // one-line human summary
}

export interface WorldDiff {
  from: string;
  to: string;
  files: FileChange[];
  unchanged: number;
  totals: {
    filesAdded: number;
    filesRemoved: number;
    filesModified: number;
    filesRenamed: number;
    rowsAdded: number;
    rowsRemoved: number;
    rowsChanged: number;
    cellsChanged: number;
    columnsAdded: number;
  };
  highlights: Flag[];
  ms: number;
}

export interface GitView {
  added: number | null;
  removed: number | null;
  binary: boolean;
  text: string; // what `git diff --stat`-style output would say
}
