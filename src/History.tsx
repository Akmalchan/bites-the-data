import { useState } from "react";
import type { AgentState } from "./types.ts";
import type { HistoryResult, Track } from "../server/history.ts";
import { api, fmt } from "./util.ts";

const EXAMPLES = ["Carla Roberts", "63", "select count(*) from deals where amount < 1000"];
const WEB_EXAMPLE = "Stripe";

export function HistorySearch({ agents, onCompare, web }: { agents: AgentState[]; onCompare: (from: string, to: string) => void; web?: boolean }) {
  const [agent, setAgent] = useState(agents.find((a) => a.id === "B")?.id ?? agents[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<HistoryResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (query = q, forAgent = agent) => {
    if (!query.trim()) return;
    setBusy(true);
    setErr("");
    try {
      setRes(await api<HistoryResult>("/api/history", { method: "POST", body: JSON.stringify({ agent: forAgent, query }) }));
    } catch (e) {
      setErr((e as Error).message);
      setRes(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card history" data-testid="history">
      <div className="history-h">
        <span className="lbl">Time-travel query</span>
        <select className="sel" value={agent} onChange={(e) => setAgent(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              across {a.id} · {a.name}
            </option>
          ))}
        </select>
        <input
          className="inp"
          style={{ flex: 1, minWidth: 220 }}
          placeholder="customer id, email, name, or SQL: select count(*) from deals where amount < 1000"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          data-testid="history-input"
          spellCheck={false}
        />
        <button className="btn primary" onClick={() => run()} disabled={busy || !q.trim()} data-testid="history-run">
          {busy ? "Scanning…" : "Search history"}
        </button>
      </div>
      {(
        <div className="history-ex">
          <span className="faint">Try:</span>
          {EXAMPLES.map((x) => (
            <button key={x} className="mini" onClick={() => { setQ(x); run(x); }}>
              {x}
            </button>
          ))}
          {web && agents.some((a) => a.id === "C") && (
            <button className="mini" title="Where did C's web-enriched values come from?" onClick={() => { setAgent("C"); setQ(WEB_EXAMPLE); run(WEB_EXAMPLE, "C"); }}>
              {WEB_EXAMPLE} (C, web sources)
            </button>
          )}
        </div>
      )}
      {err && <div className="err" style={{ padding: "0 12px 10px" }}>{err}</div>}
      {res && (
        <div className="history-b" data-testid="history-result">
          <div className="answer">{res.sentence}</div>
          <div className="faint mono" style={{ fontSize: 11.5 }}>
            scanned {res.scanned} checkpoints in {fmt(res.ms)} ms{res.mode === "value" ? ` · ${res.matchedRows} matching record${res.matchedRows === 1 ? "" : "s"}` : ""}
          </div>
          {res.mode === "sql" && res.series && (
            <div className="tl-mini">
              {res.series.map((p, i) => {
                const changed = i > 0 && p.value !== res.series![i - 1].value;
                return (
                  <div key={p.world} className={`tl-cell ${changed ? "chg" : ""}`} title={res.chain[i].stepName} onClick={() => i > 0 && onCompare(res.chain[i - 1].world, p.world)}>
                    <div className="tl-v mono">{p.value === null ? "—" : typeof p.value === "number" ? fmt(p.value) : String(p.value)}</div>
                    <div className="tl-s">{p.step === 0 ? "base" : p.step}</div>
                  </div>
                );
              })}
            </div>
          )}
          {res.tracks.map((t) => (
            <TrackRow key={t.id} t={t} res={res} onCompare={onCompare} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrackRow({ t, res, onCompare }: { t: Track; res: HistoryResult; onCompare: (from: string, to: string) => void }) {
  return (
    <div className="track">
      <div className="track-name">
        <span className="mono">{t.where}</span> <b>{t.key}</b> {t.label && <span className="muted">{t.label}</span>}
      </div>
      <div className="dots">
        {t.states.map((s, i) => {
          const ev = t.events.find((e) => e.world === s.world);
          const cls = ev?.kind === "vanished" ? "gone-now" : !s.present ? "gone" : s.changed ? "chg" : "ok";
          return (
            <span
              key={s.world}
              className={`dot2 ${cls}`}
              title={`${s.world}${res.chain[i].stepName ? ` · ${res.chain[i].stepName}` : ""}: ${ev ? `${ev.kind} ${ev.detail}` : s.present ? "present" : "absent"}`}
              onClick={() => i > 0 && onCompare(res.chain[i - 1].world, s.world)}
            >
              {s.step === 0 ? "B" : s.step}
            </span>
          );
        })}
      </div>
      <div className="track-ev">
        {t.events.length === 0 ? (
          <span className="faint">no changes</span>
        ) : (
          t.events.map((e) => (
            <span key={e.world} className={`ev ${e.kind}`}>
              {e.world}: {e.kind === "changed" ? e.detail : e.kind}
              {e.source && (
                <>
                  {" · source "}
                  <a href={e.source} target="_blank" rel="noreferrer" className="src">{new URL(e.source).hostname}</a>
                </>
              )}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
