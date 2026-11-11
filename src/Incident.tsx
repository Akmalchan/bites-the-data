// "What went wrong" drawer: the plain-English incident for one broken agent, what's missing, and a
// copy-paste fix prompt for your AI agent.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmt } from "./util.ts";

interface Incident {
  agent: string;
  name: string;
  end: string;
  sentence: string;
  rules: { label: string; expr: string; value: string; firstBad?: string; step?: number; stepName?: string; thought?: string; checks: number }[];
  lost: { id: unknown; name: unknown; email: unknown; company: unknown; country: unknown }[];
  lostCount: number;
  merged: number;
  deals: { id: unknown; before: unknown; after: unknown; customer?: unknown }[];
  restore: { world: string; ref?: string; stepName?: string };
  prompt: string;
  csv: string;
  tabs: { id: string; label: string; columns: string[]; rows: string[][] }[];
  fixVariant: string;
  csvName: string;
}

export function IncidentDrawer({
  agent, onClose, onRollback, onFix, flash,
}: {
  agent: string;
  onClose: () => void;
  onRollback: (world: string) => void;
  onFix: (world: string, variant: string) => void;
  flash: (t: string) => void;
}) {
  const [inc, setInc] = useState<Incident | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<string>("missing");
  const [q, setQ] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api<Incident>(`/api/incident?agent=${encodeURIComponent(agent)}`).then(setInc).catch((e) => setErr(String(e.message)));
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [agent, onClose]);

  const current = inc?.tabs.find((t) => t.id === tab) ?? inc?.tabs[0];
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = current?.rows ?? [];
    return s ? list.filter((r) => r.some((v) => v.toLowerCase().includes(s))) : list;
  }, [current, q]);

  const copy = async () => {
    if (!inc) return;
    try {
      await navigator.clipboard.writeText(inc.prompt);
      flash("Copied the fix prompt. Paste it into your AI agent.");
    } catch {
      setShowPrompt(true);
      setTimeout(() => {
        promptRef.current?.focus();
        promptRef.current?.select();
      }, 50);
      flash("Clipboard blocked here: the prompt is selected below, press Cmd+C.");
    }
  };
  const download = () => {
    if (!inc) return;
    const url = URL.createObjectURL(new Blob([inc.csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = inc.csvName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const fixStep = inc?.restore.world;
  return (
    <div className="inc-overlay" onClick={onClose}>
      <aside className="inc" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="What went wrong" data-testid="incident">
        <div className="inc-h">
          <span className="inc-kicker">What went wrong</span>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={onClose} ref={closeRef} aria-label="Close">
            ✕
          </button>
        </div>
        {err && <div className="err" style={{ padding: 20 }}>{err}</div>}
        {!inc && !err && <div className="empty">Reading the checkpoints…</div>}
        {inc && (
          <div className="inc-b">
            <p className="inc-sentence" data-testid="incident-sentence">{inc.sentence}</p>
            <div className="inc-rules">
              {inc.rules.map((r) => (
                <div key={r.label} className="inc-rule">
                  <span className="inc-x">✗</span>
                  <div>
                    <b>{r.label}</b> broke at <b>step {r.step}</b> ({r.stepName})
                    {r.thought && <div className="inc-thought">Agent's reasoning: "{r.thought}"</div>}
                  </div>
                </div>
              ))}
            </div>

            <div className="inc-actions">
              <button className="btn primary inc-copy" onClick={copy} data-testid="copy-prompt" title="Copy a ready-made prompt for Claude/Cursor to fix this">
                Copy fix prompt for your AI agent
              </button>
              <button className="btn" onClick={download} data-testid="download-missing">
                Download {inc.tabs[0]?.label.toLowerCase() ?? "missing rows"} (CSV)
              </button>
              {fixStep && fixStep !== "base" && (
                <>
                  <button className="btn" onClick={() => onRollback(fixStep)} title="Undo this agent's work after this step">
                    ↺ Roll back to step {fixStep.split("@")[1]}
                  </button>
                  <button className="btn fix" onClick={() => onFix(fixStep, inc.fixVariant)} data-testid="fix-fork" title="Redo the job safely from the last good step">
                    ⑂ Fix it: fork from step {fixStep.split("@")[1]} with {inc.fixVariant}
                  </button>
                </>
              )}
            </div>
            {showPrompt && <textarea ref={promptRef} className="inc-prompt" readOnly value={inc.prompt} aria-label="Fix prompt" />}

            <div className="inc-tabs" role="tablist">
              {inc.tabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={current?.id === t.id} className={`ftab ${current?.id === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} data-testid={`inc-tab-${t.id}`}>
                  {t.label} <span className="inc-count">{fmt(t.rows.length)}</span>
                </button>
              ))}
              <span className="spacer" />
              <input className="inp inc-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search rows" />
            </div>
            <div className="inc-table">
              <table className="grid">
                <thead>
                  <tr>{current?.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 400).map((r, i) => (
                    <tr key={i} className={current?.id === "missing" ? "rm lost" : ""}>
                      {r.map((v, j) => <td key={j} className={v.includes("→") ? "chg" : ""}>{v}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 400 && <div className="more">Showing 400 of {fmt(rows.length)}. The CSV has all of them.</div>}
              {rows.length === 0 && <div className="more">Nothing here.</div>}
            </div>
            {inc.merged > 0 && <p className="inc-note">{inc.merged} other removed rows were true duplicates (their email still exists), so they are fine.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}
