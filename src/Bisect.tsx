import { useState } from "react";
import type { AgentState, BisectResult, Preset, WorldMeta } from "./types.ts";

interface Props {
  agents: AgentState[];
  presets: Preset[];
  worlds: WorldMeta[];
  live: (BisectResult & { phase?: string }) | null;
  onClose: () => void;
  onRun: (agent: string, invariant: string) => Promise<void>;
  onShow: (from: string, to: string) => void;
  onRollback: (world: string) => void;
  initialAgent?: string;
  inline?: boolean;
}

export function BisectModal({ agents, presets, worlds, live, onClose, onRun, onShow, onRollback, initialAgent, inline }: Props) {
  const [agent, setAgent] = useState(initialAgent ?? agents.find((a) => a.id === "B")?.id ?? agents[0]?.id ?? "");
  const [preset, setPreset] = useState(presets[0]?.id ?? "custom");
  const [expr, setExpr] = useState(presets[0]?.expr ?? "rows(customers.csv) >= 4900");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const steps = worlds.filter((w) => w.agent === agent && w.kind === "checkpoint").sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  const chain = [{ id: "base", step: 0, stepName: "base" } as WorldMeta, ...steps];
  const res = live && live.agent === agent && live.invariant === expr ? live : null;
  const done = res?.phase === "done";

  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      await onRun(agent, expr);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nodeState = (id: string, step: number) => {
    const c = res?.checks.find((x) => x.world === id);
    if (c) return { cls: c.ok ? "good" : "bad", mark: c.ok ? "✓" : "✗" };
    if (done && res?.verdict === "found" && res.firstBad) {
      const fb = Number(res.firstBad.split("@")[1]);
      return step < fb ? { cls: "good inferred", mark: "" } : { cls: "bad inferred", mark: "" };
    }
    return { cls: "", mark: "" };
  };

  const firstBadMeta = res?.firstBad ? worlds.find((w) => w.id === res.firstBad) : undefined;

  return (
    <div className={inline ? "inline-host" : "overlay"} onClick={inline ? undefined : onClose}>
      <div className={inline ? "card bisect-page" : "modal"} onClick={(e) => e.stopPropagation()} data-testid="bisect-modal">
        <div className="modal-h">
          <h3>Bisect an agent's checkpoints</h3>
          <span className="muted">Binary-search for the first step that breaks an invariant.</span>
          <div className="spacer" />
          {!inline && <button className="btn ghost sm" onClick={onClose}>Close</button>}
        </div>
        <div className="modal-b">
          <div className="row">
            <label>Agent</label>
            <select className="sel" value={agent} onChange={(e) => setAgent(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.name} ({a.stepsDone} checkpoints)
                </option>
              ))}
            </select>
            <label style={{ minWidth: 0, marginLeft: 8 }}>Invariant</label>
            <select
              className="sel"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                const p = presets.find((x) => x.id === e.target.value);
                if (p) setExpr(p.expr);
              }}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </div>
          <div className="row">
            <label>Check</label>
            <input className="inp" style={{ flex: 1 }} value={expr} onChange={(e) => { setExpr(e.target.value); setPreset("custom"); }} data-testid="invariant" spellCheck={false} />
            <button className="btn primary" onClick={run} disabled={busy || !agent} data-testid="bisect-run">
              {busy ? "Bisecting…" : "Run bisect"}
            </button>
          </div>
          <div className="faint" style={{ fontSize: 12 }}>
            Functions: <span className="mono">rows(file.csv)</span>, <span className="mono">sql(db.sqlite, "select …")</span>, <span className="mono">exists(path)</span>, <span className="mono">size(path)</span>; combine with <span className="mono">and</span>.
          </div>

          <div className="timeline" data-testid="timeline">
            {chain.map((w) => {
              const s = nodeState(w.id, w.step ?? 0);
              const first = res?.firstBad === w.id && done;
              return (
                <div key={w.id} className={`tl-node ${s.cls} ${first ? "first" : ""}`} title={w.stepName}>
                  <div className="tl-circle">{w.step === 0 ? "B" : w.step}</div>
                  <div className="tl-mark">{s.mark}</div>
                  <div className="tl-label">{w.step === 0 ? "base" : w.stepName}</div>
                </div>
              );
            })}
          </div>

          <div className="log" data-testid="bisect-log">
            {!res && <span className="faint">Checks will appear here. Endpoints are verified first, then the search halves the range each time.</span>}
            {res?.checks.map((c, i) => (
              <div key={i}>
                <span className="faint">{c.phase === "endpoint" ? "endpoint" : `check ${res.checks.slice(0, i + 1).filter((x) => x.phase === "bisect").length}`.padEnd(8)}</span>{" "}
                {c.step === 0 ? "base" : `step ${c.step}`} <span className={c.ok ? "ok" : "bad"}>{c.ok ? "✓ holds" : "✗ fails"}</span> <span className="faint">({c.value})</span>
              </div>
            ))}
          </div>

          {done && res?.verdict === "found" && (
            <div className="verdict" data-testid="bisect-verdict">
              <h4>
                Step {res.firstBad?.split("@")[1]} broke it: {res.stepName}
              </h4>
              <div className="muted">
                Found in {res.bisectChecks} bisect check{res.bisectChecks === 1 ? "" : "s"} ({res.checks.length} total, including endpoints) across {res.totalSteps} checkpoints.
                {firstBadMeta?.thought ? ` The agent's reasoning: "${firstBadMeta.thought}"` : ""}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn primary" onClick={() => onShow(res.lastGood!, res.firstBad!)} data-testid="bisect-show">
                  Show what step {res.firstBad?.split("@")[1]} changed
                </button>
                {res.lastGood && res.lastGood !== "base" && (
                  <button className="btn" onClick={() => onRollback(res.lastGood!)} data-testid="bisect-rollback">
                    Roll back {res.agent} to step {res.lastGood.split("@")[1]}
                  </button>
                )}
              </div>
            </div>
          )}
          {done && res?.verdict === "holds" && (
            <div className="verdict okv">
              <h4>The invariant holds at the agent's final checkpoint</h4>
              <div className="muted">Nothing to bisect.</div>
            </div>
          )}
          {done && res?.verdict === "broken-at-base" && (
            <div className="verdict">
              <h4>Already failing at the base world</h4>
              <div className="muted">The agent did not introduce this; check the invariant's threshold.</div>
            </div>
          )}
          {(err || (done && res?.verdict === "error")) && <div className="err">{err || res?.error}</div>}
        </div>
      </div>
    </div>
  );
}
