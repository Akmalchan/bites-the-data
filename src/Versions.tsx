// VERSIONS sidebar: one collapsible group per agent (status chip + step count), steps inside,
// roll back / fork actions per step, and a "continue from this step with…" fork popover.
import { useEffect, useRef, useState } from "react";
import type { AgentState, BisectResult, WorldMeta } from "./types.ts";
import { AGENT_COLOR, ms, type AppState } from "./App.tsx";
import { useRogues } from "./Dashboard.tsx";

interface Props {
  st: AppState;
  from: string;
  to: string;
  setFrom: (v: string) => void;
  compare: (f: string, t: string) => void;
  rollback: (w: string) => void;
  fork: (w: string) => void;
  forkRun: (w: string, variant: string) => void;
  bisectFor?: BisectResult;
  onIncident?: (agent: string) => void;
}

export function VersionsSidebar({ st, from, to, setFrom, compare, rollback, fork, forkRun, bisectFor, onIncident }: Props) {
  const rogues = useRogues(st);
  const owner = st.worlds.find((w) => w.id === to)?.agent;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pop, setPop] = useState<string | null>(null);
  // Broken agents start expanded, clean ones collapsed; user toggles win until the next run starts.
  const isOpen = (a: AgentState) => open[a.id] ?? (a.status === "running" || (rogues[a.id] ? !rogues[a.id].ok : a.id === owner));
  useEffect(() => {
    if (st.running) setOpen({});
  }, [st.running]);
  const badge = (id: string) => (
    <>
      {from === id && <span className="ft from">FROM</span>}
      {to === id && <span className="ft to">TO</span>}
    </>
  );
  const variants = (st as AppState & { forkVariants?: string[] }).forkVariants ?? ["Merger (exact)", "Formatter (emails)", "Enricher (lite)"];

  return (
    <aside className="sidebar versions">
      <div className="side-h">
        <span>Versions</span>
        <span>{st.worlds.filter((w) => w.kind !== "fork").length}</span>
      </div>
      {st.worlds
        .filter((w) => w.kind === "base")
        .map((w) => (
          <div key={w.id} className={`v-row v-base ${to === w.id ? "sel" : ""}`} onClick={() => setFrom(w.id)} title="Original data. Click to compare from here.">
            <span className="v-dot" style={{ background: "var(--text)" }} />
            <span className="v-name">
              <b>base</b> <span className="muted">original data</span>
            </span>
            {badge(w.id)}
          </div>
        ))}
      {st.agents.map((a) => {
        const steps = st.worlds.filter((w) => w.agent === a.id && w.kind === "checkpoint").sort((x, y) => (x.step ?? 0) - (y.step ?? 0));
        const r = rogues[a.id];
        const o = isOpen(a);
        return (
          <div key={a.id} className="v-group">
            <button className="v-row v-head" onClick={() => setOpen({ ...open, [a.id]: !o })} aria-expanded={o} data-testid={`group-${a.id}`}>
              <span className={`v-chev ${o ? "open" : ""}`}>›</span>
              <span className="v-dot" style={{ background: AGENT_COLOR[a.id] }} />
              <span className="v-name">
                {a.forkOf && <span className="v-forkmark" title={`Forked from ${a.forkOf}`}>⑂ </span>}
                {a.name}
              </span>
              {a.status === "running" ? (
                <span className="chip run">running</span>
              ) : r ? (
                r.ok ? (
                  <span className="chip ok">✓ clean</span>
                ) : (
                  <span
                    className="chip bad clickable"
                    role="button"
                    tabIndex={0}
                    title="See what went wrong"
                    onClick={(e) => {
                      e.stopPropagation();
                      onIncident?.(a.id);
                    }}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.stopPropagation(), onIncident?.(a.id))}
                  >
                    ✗ broke{r.firstBad !== undefined ? ` @${r.firstBad}` : ""}
                  </span>
                )
              ) : null}
              <span className="v-count">{steps.length}</span>
            </button>
            {a.forkOf && o && <div className="v-sub">from {a.forkOf} ({a.forkSource}){a.forkRef ? ` · Archil branch` : ""}</div>}
            {o && (
              <div className="v-steps">
                {steps.map((w: WorldMeta) => {
                  const undone = a.rolledBackTo !== undefined && (w.step ?? 0) > a.rolledBackTo;
                  const isHead = a.rolledBackTo !== undefined && w.step === a.rolledBackTo;
                  const bad = r?.firstBad === w.step || (bisectFor?.verdict === "found" && bisectFor.firstBad === w.id);
                  const sel = to === w.id || pop === w.id;
                  return (
                    <div key={w.id} className="v-stepwrap">
                      <div
                        className={`v-row v-step ${sel ? "sel" : ""} ${undone ? "undone" : ""} ${bad ? "bad" : ""}`}
                        onClick={() => compare(w.parent ?? "base", w.id)}
                        data-testid={`node-${w.id}`}
                        title={`${w.stepName}\nClick to see what this step changed${w.ref ? `\nArchil checkpoint ${w.ref}` : ""}`}
                      >
                        <span className="v-num">{w.step}</span>
                        <span className="v-name">{w.stepName}</span>
                        {badge(w.id)}
                        {isHead && <span className="ft head">HEAD</span>}
                        {bad && !isHead && <span className="ft bad">FIRST BAD</span>}
                        <span className="v-ms">{ms(w.snapshotMs)}</span>
                        <span className="v-acts">
                          <button
                            className="v-act"
                            title="Undo this agent's work after this step"
                            onClick={(e) => {
                              e.stopPropagation();
                              rollback(w.id);
                            }}
                            disabled={st.running}
                            data-testid={`rollback-${w.id}`}
                          >
                            ↺ Roll back
                          </button>
                          <button
                            className="v-act"
                            title="Start a new branch from this step"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPop(pop === w.id ? null : w.id);
                            }}
                            disabled={st.running}
                            data-testid={`fork-${w.id}`}
                          >
                            ⑂ Fork
                          </button>
                        </span>
                      </div>
                      {pop === w.id && (
                        <ForkPopover
                          world={w.id}
                          variants={variants}
                          onClose={() => setPop(null)}
                          onPick={(v) => {
                            setPop(null);
                            if (v) forkRun(w.id, v);
                            else fork(w.id);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                {a.status === "running" && (
                  <div className="v-row v-step">
                    <span className="v-num">{a.stepsDone + 1 + (a.forkOf ? Number(a.forkOf.split("@")[1]) : 0)}</span>
                    <span className="v-name muted">{a.currentStep ?? "working…"}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="legend">Each version is a frozen checkpoint ({st.backend.snapshotVerb}). Click a step to see what it changed. Hover for roll back and fork.</div>
    </aside>
  );
}

function ForkPopover({ world, variants, onPick, onClose }: { world: string; variants: string[]; onPick: (v: string | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="fork-pop" ref={ref} role="dialog" aria-label={`Fork from ${world}`} data-testid="fork-pop">
      <div className="fork-pop-h">Continue from {world} with:</div>
      {variants.map((v) => (
        <button key={v} className="fork-opt" onClick={() => onPick(v)} data-testid={`fork-opt-${v}`}>
          {v}
        </button>
      ))}
      <button className="fork-opt plain" onClick={() => onPick(null)}>
        nothing — just branch
      </button>
    </div>
  );
}
