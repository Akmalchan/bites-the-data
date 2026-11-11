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
  const [tab, setTab] = useState<"missing" | "deals">("missing");
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

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = inc?.lost ?? [];
    return s ? list.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(s))) : list;
  }, [inc, q]);

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
    a.download = `missing_customers_${inc.agent}.csv`;
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
                Download missing rows (CSV)
              </button>
              {fixStep && fixStep !== "base" && (
                <>
                  <button className="btn" onClick={() => onRollback(fixStep)} title="Undo this agent's work after this step">
                    ↺ Roll back to step {fixStep.split("@")[1]}
                  </button>
                  <button className="btn fix" onClick={() => onFix(fixStep, "Merger (exact)")} data-testid="fix-fork" title="Redo the job safely from the last good step">
                    ⑂ Fix it: fork from step {fixStep.split("@")[1]} with Merger (exact)
                  </button>
                </>
              )}
            </div>
            {showPrompt && <textarea ref={promptRef} className="inc-prompt" readOnly value={inc.prompt} aria-label="Fix prompt" />}

            <div className="inc-tabs" role="tablist">
              <button role="tab" aria-selected={tab === "missing"} className={`ftab ${tab === "missing" ? "on" : ""}`} onClick={() => setTab("missing")}>
                Missing customers <span className="inc-count">{fmt(inc.lostCount)}</span>
              </button>
              <button role="tab" aria-selected={tab === "deals"} className={`ftab ${tab === "deals" ? "on" : ""}`} onClick={() => setTab("deals")}>
                Changed deals <span className="inc-count">{fmt(inc.deals.length)}</span>
              </button>
              <span className="spacer" />
              {tab === "missing" && <input className="inp inc-search" placeholder="Search name, email, company…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search missing customers" />}
            </div>
            <div className="inc-table">
              {tab === "missing" ? (
                <table className="grid">
                  <thead>
                    <tr><th>id</th><th>name</th><th>email</th><th>company</th></tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 400).map((r) => (
                      <tr key={String(r.id)} className="rm lost">
                        <td>{String(r.id)}</td><td>{String(r.name)}</td><td>{String(r.email)}</td><td>{String(r.company)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="grid">
                  <thead>
                    <tr><th>deal</th><th>customer</th><th>amount before → after</th></tr>
                  </thead>
                  <tbody>
                    {inc.deals.slice(0, 400).map((d) => (
                      <tr key={String(d.id)}>
                        <td>{String(d.id)}</td>
                        <td>{String(d.customer ?? "")}</td>
                        <td className="chg"><span className="before">{fmt(Number(d.before))}</span><span className="after">{fmt(Number(d.after))}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "missing" && rows.length > 400 && <div className="more">Showing 400 of {fmt(rows.length)}. The CSV has all of them.</div>}
            </div>
            {inc.merged > 0 && <p className="inc-note">{inc.merged} other removed rows were true duplicates (their email still exists), so they are fine.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}
