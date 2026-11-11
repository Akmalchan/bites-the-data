import { parse } from "csv-parse/sync";
import { diffTables, type TableInput } from "./table.ts";
import type { CsvDiff, Row } from "./types.ts";

export function parseCsv(text: string): TableInput {
  const delimiter = sniffDelimiter(text);
  const records: string[][] = parse(text, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    bom: true,
  });
  if (records.length === 0) return { columns: [], rows: [] };
  const header = records[0].map((h, i) => (h.trim() === "" ? `column_${i + 1}` : h.trim()));
  const rows: Row[] = new Array(records.length - 1);
  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    const row: Row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = rec[j] ?? "";
    rows[i - 1] = row;
  }
  return { columns: header, rows };
}

function sniffDelimiter(text: string): string {
  const first = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const tabs = first.split("\t").length;
  const commas = first.split(",").length;
  const semis = first.split(";").length;
  if (tabs > commas && tabs > semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

export function diffCsv(name: string, before: string, after: string): CsvDiff {
  return { type: "csv", table: diffTables(parseCsv(before), parseCsv(after), { name }) };
}

/** Row count without building row objects (used by invariants). */
export function csvRowCount(text: string): number {
  return parseCsv(text).rows.length;
}
