import { useEffect, useMemo, useState } from "react";
import type { Cell, FileChange, FileDetail, GitView, JsonDiff, Row, SqliteDiff, TableDiff, TextDiff, BinaryDiff } from "./types.ts";
import { WarnIcon } from "./icons.tsx";
import { api, bytes, cell, fmt, show } from "./util.ts";

export function FileDetailView({ from, to, fc }: { from: string; to: string; fc: FileChange }) {
  const [data, setData] = useState<{ detail?: FileDetail; git?: GitView | { error: string } } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<{ detail?: FileDetail; git?: GitView }>(`/api/diff/file?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&path=${encodeURIComponent(fc.path)}`)
      .then(setData)
      .catch((e) => setErr(String(e.message)));
  }, [from, to, fc.path]);

  const git = data?.git && !("error" in data.git) ? (data.git as GitView) : null;
  return (
    <div>
      <div className="detail-h">
        <div className="path">
          <span className={`st ${fc.status}`}>{fc.status[0].toUpperCase()}</span>
          {fc.oldPath && <span className="faint">{fc.oldPath} →</span>}
          {fc.path}
          <span className="kind">{fc.kind}</span>
          <span className="faint" style={{ marginLeft: "auto", fontWeight: 400 }}>
            {bytes(fc.sizeBefore)} → {bytes(fc.sizeAfter)}
          </span>
        </div>
        {fc.status !== "renamed" && (
          <div className="vs">
            <div className="vsbox">
              <div className="h">What git shows</div>
              <div className="v" data-testid="gitview">{git ? git.text : data ? "n/a" : "…"}</div>
            </div>
            <div className="vsbox delta">
              <div className="h">What Delta shows</div>
              <div className="v" data-testid="deltaview">{fc.summary}</div>
            </div>
          </div>
        )}
        {fc.flags.map((f, i) => (
          <div key={i} className={`callout ${f.level}`}>
            {f.level === "warn" && <WarnIcon />}
            <span>{f.text.replace(/^[^:]+:\s*/, "")}</span>
          </div>
        ))}
      </div>
      {err && <div className="empty err">{err}</div>}
      {!data && !err && <div className="empty">Loading…</div>}
      {data?.detail && <Body d={data.detail} fc={fc} />}
      {fc.status === "renamed" && (
        <div className="empty">
          Renamed from <span className="mono">{fc.oldPath}</span>. Content identical (sha256 {fc.hashAfter?.slice(0, 12)}).
        </div>
      )}
    </div>
  );
}

function Body({ d, fc }: { d: FileDetail; fc: FileChange }) {
  switch (d.type) {
    case "csv":
      return <TableView t={d.table} status={fc.status} />;
    case "sqlite":
      return <SqliteView d={d} status={fc.status} />;
    case "json":
      return <JsonView d={d} />;
    case "text":
      return <TextView d={d} />;
    case "binary":
      return <BinaryView d={d} />;
  }
}

function SqliteView({ d, status }: { d: SqliteDiff; status: string }) {
  const tables = d.tables.filter((t) => t.status !== "unchanged" || status !== "modified");
  return (
    <div>
      {d.bytesOnlyChange && <div className="empty">The file's bytes changed, but every table has identical rows (page layout only, e.g. VACUUM).</div>}
      {tables.map((t) => (
        <div key={t.name} className="tbl-section">
          <div className="tbl-title">
            <span className="mono">{t.name}</span>
            <span className="sum">
              {t.status === "modified" ? `${fmt(t.rowsBefore)} → ${fmt(t.rowsAfter)} rows` : t.status}
            </span>
          </div>
          <TableView t={t} status={t.status === "added" ? "added" : t.status === "removed" ? "removed" : "modified"} compact />
        </div>
      ))}
      {d.tables.filter((t) => t.status === "unchanged").length > 0 && status === "modified" && (
        <div className="more">Unchanged tables: {d.tables.filter((t) => t.status === "unchanged").map((t) => t.name).join(", ")}</div>
      )}
    </div>
  );
}

const PAGE = 150;

function keyOf(row: Row, key: string[]): string {
  return key.length === 1 ? String(row[key[0]] ?? "") : key.map((k) => String(row[k] ?? "")).join("␟");
}

function TableView({ t, status, compact }: { t: TableDiff; status: string; compact?: boolean }) {
  const lost = useMemo(() => new Set(t.twins?.unmatchedKeys ?? []), [t]);
  const tabs = [
    { id: "removed", label: "Removed rows", n: t.removedCount, danger: (t.twins?.unmatched ?? t.removedCount) > 0 },
    { id: "changed", label: "Changed rows", n: t.changedCount, danger: t.magnitude.length > 0 },
    { id: "added", label: "Added rows", n: t.addedCount, danger: false },
    { id: "columns", label: "Columns", n: t.columnsAdded.length + t.columnsRemoved.length, danger: t.columnsRemoved.length > 0 },
  ].filter((x) => x.n > 0);
  const [tab, setTab] = useState(tabs.find((x) => x.danger)?.id ?? tabs[0]?.id ?? "");
  const [limit, setLimit] = useState(PAGE);
  const [colFilter, setColFilter] = useState<string | null>(null);
  const [lostOnly, setLostOnly] = useState(false);

  if (status === "added" || status === "removed") {
    return <div className="more">{status === "added" ? `New: ${fmt(t.rowsAfter)} rows` : `Deleted: ${fmt(t.rowsBefore)} rows`} · columns {t.columns.filter((c) => c !== "__rowid").join(", ")}</div>;
  }
  if (tabs.length === 0) return <div className="more">No row-level changes.</div>;

  const cols = t.columns.filter((c) => c !== "__rowid");
  const keyCol = t.key.length === 1 && t.key[0] !== "__rowid" ? t.key[0] : null;
  const displayCols = keyCol ? [keyCol, ...cols.filter((c) => c !== keyCol)] : cols;

  let rows: { row: Row; cls: string; cells?: Record<string, { before: Cell; after: Cell }>; tag?: string }[] = [];
  if (tab === "removed") {
    rows = t.removed.map((r) => {
      const isLost = t.twins ? lost.has(keyOf(r, t.key)) : true;
      return { row: r, cls: `rm ${isLost ? "lost" : ""}`, tag: t.twins ? (isLost ? "lost" : "merged") : undefined };
    });
    if (lostOnly) rows = rows.filter((r) => r.tag === "lost");
    rows.sort((a, b) => (a.tag === b.tag ? 0 : a.tag === "lost" ? -1 : 1));
  } else if (tab === "added") rows = t.added.map((r) => ({ row: r, cls: "ad" }));
  else if (tab === "changed") {
    rows = t.changed.filter((c) => !colFilter || colFilter in c.cells).map((c) => ({ row: c.row, cls: "", cells: c.cells }));
  }
  const total = rows.length;

  return (
    <div>
      {!compact && (
        <div className="keyinfo">
          <span>
            rows <b className="num">{fmt(t.rowsBefore)}</b> → <b className="num">{fmt(t.rowsAfter)}</b>
          </span>
          <span>
            matched by <b className="mono">{t.key.join(", ") || "row hash"}</b> <span className="faint">({t.keySource})</span>
          </span>
          {t.twins && t.removedCount > 0 && (
            <span>
              of {fmt(t.removedCount)} removed: <b style={{ color: "var(--del)" }}>{fmt(t.twins.unmatched)} lost</b> · {fmt(t.twins.matched)} merged (same {t.twins.column} survives)
            </span>
          )}
        </div>
      )}
      <div className="tabs">
        {tabs.map((x) => (
          <div key={x.id} className={`tab ${tab === x.id ? "on" : ""} ${x.danger ? "danger" : ""}`} onClick={() => { setTab(x.id); setLimit(PAGE); }} data-testid={`tab-${x.id}`}>
            {x.label}
            <span className="c">{fmt(x.n)}</span>
          </div>
        ))}
      </div>
      {tab === "changed" && Object.keys(t.columnChangeCounts).length > 0 && (
        <div className="more">
          <span className="faint">by column:</span>
          {Object.entries(t.columnChangeCounts).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
            <button key={c} className={`btn sm ${colFilter === c ? "primary" : ""}`} onClick={() => setColFilter(colFilter === c ? null : c)}>
              {c} <span className="mono">{fmt(n)}</span>
            </button>
          ))}
          {t.magnitude.map((m) => (
            <span key={m.column} className="tag lost">
              {fmt(m.count)} {m.column} ≥10x
            </span>
          ))}
        </div>
      )}
      {tab === "removed" && t.twins && t.twins.matched > 0 && t.twins.unmatched > 0 && (
        <div className="more">
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={lostOnly} onChange={(e) => setLostOnly(e.target.checked)} /> only rows with no surviving {t.twins.column}
          </label>
        </div>
      )}
      {tab === "columns" ? (
        <div className="trace">
          {t.columnsAdded.map((c) => (
            <div key={c} className="call">
              <span className="tool" style={{ color: "var(--add)" }}>added</span>
              <span className="in">{c}</span>
              <span />
            </div>
          ))}
          {t.columnsRemoved.map((c) => (
            <div key={c} className="call">
              <span className="tool" style={{ color: "var(--del)" }}>dropped</span>
              <span className="in">{c}</span>
              <span />
            </div>
          ))}
          {t.schemaBefore !== t.schemaAfter && t.schemaAfter && (
            <div className="mono faint" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{t.schemaAfter}</div>
          )}
        </div>
      ) : (
        <div className="tablewrap">
          <table className="grid" data-testid={`table-${tab}`}>
            <thead>
              <tr>
                {tab === "removed" && t.twins && <th />}
                {displayCols.map((c) => (
                  <th key={c}>
                    {c}
                    {t.columnsAdded.includes(c) && <span className="tag merged" style={{ marginLeft: 6 }}>new</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r, i) => (
                <tr key={i} className={r.cls}>
                  {tab === "removed" && t.twins && <td>{r.tag && <span className={`tag ${r.tag}`}>{r.tag}</span>}</td>}
                  {displayCols.map((c) => {
                    const ch = r.cells?.[c];
                    if (ch)
                      return (
                        <td key={c} className="chg" title={`${show(ch.before)} → ${show(ch.after)}`}>
                          {cell(ch.before, c) === "" ? <span className="faint" style={{ marginRight: 6 }}>empty</span> : <span className="before">{cell(ch.before, c)}</span>}
                          {cell(ch.after, c) === "" ? <span className="faint">empty</span> : <span className="after">{cell(ch.after, c)}</span>}
                        </td>
                      );
                    return (
                      <td key={c} className={t.columnsAdded.includes(c) && tab === "changed" ? "newcol" : ""} title={show(r.row[c])}>
                        {cell(r.row[c], c)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab !== "columns" && total > limit && (
        <div className="more">
          Showing {fmt(limit)} of {fmt(total)}
          <button className="btn sm" onClick={() => setLimit(limit + 500)}>Show more</button>
        </div>
      )}
      {t.truncated && <div className="more faint">Samples capped at 2,000 rows per category; counts are exact.</div>}
    </div>
  );
}

function JsonView({ d }: { d: JsonDiff }) {
  if (d.parseError) return <div className="empty err">Invalid JSON: {d.parseError}</div>;
  return (
    <div>
      {d.changes.map((c, i) => (
        <div className="json-row" key={i}>
          <span className={`k ${c.kind}`}>{c.kind}</span>
          <span>{c.path}</span>
          <span className="val">
            {c.kind !== "added" && <span className="before">{show(c.before)}</span>}
            {c.kind !== "removed" && <span className="after">{show(c.after)}</span>}
          </span>
        </div>
      ))}
      {d.truncated && <div className="more">Showing {fmt(d.changes.length)} of {fmt(d.total)} paths</div>}
    </div>
  );
}

function TextView({ d }: { d: TextDiff }) {
  return (
    <div className="udiff">
      {d.hunks.map((h, i) => {
        let o = h.oldStart;
        let n = h.newStart;
        return (
          <div key={i}>
            <div className="hunk">@@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@</div>
            {h.lines.map((l, j) => {
              const kind = l[0] === "+" ? "add" : l[0] === "-" ? "del" : "";
              const on = kind === "add" ? "" : String(o++);
              const nn = kind === "del" ? "" : String(n++);
              return (
                <div key={j} className={`ln ${kind}`}>
                  <span>{on}</span>
                  <span>{nn}</span>
                  <span>{l}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {d.truncated && <div className="more">Diff truncated</div>}
    </div>
  );
}

function BinaryView({ d }: { d: BinaryDiff }) {
  return (
    <div className="bin">
      <span className="faint" />
      <span className="faint">before</span>
      <span className="faint">after</span>
      <span className="faint">size</span>
      <span>{bytes(d.sizeBefore)}</span>
      <span>{bytes(d.sizeAfter)}</span>
      <span className="faint">sha256</span>
      <span>{d.hashBefore?.slice(0, 16) ?? "—"}</span>
      <span>{d.hashAfter?.slice(0, 16) ?? "—"}</span>
      {d.note && <span style={{ gridColumn: "1 / -1" }} className="faint">{d.note}</span>}
    </div>
  );
}
