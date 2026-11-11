import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentState, BisectResult, FileChange, Preset, ToolCall, WorldDiff, WorldMeta } from "./types.ts";
import { FileDetailView } from "./FileDetail.tsx";
import { BisectModal } from "./Bisect.tsx";
import { HistorySearch } from "./History.tsx";
import { Logo, WarnIcon } from "./icons.tsx";
import { VersionsSidebar } from "./Versions.tsx";
import { IncidentDrawer } from "./Incident.tsx";
import { api, fmt } from "./util.ts";
import { Dashboard, PageHost, PageIntro, Rail, pageFromHash, type ClassicPage } from "./Dashboard.tsx";

export interface AppState {
  backend: {
    kind: "local" | "archil"; label: string; detail: string; snapshotVerb: string; forkVerb: string; error?: string; execCalls?: number; checkpoints?: number;
    stats?: { execCalls: number; checkpoints: number; branches: number; bytesReadFromCheckpoints: number; checkpointReads: number; objectWrites: number; bytesWritten: number };
  };
  llm: { available: boolean; model: string };
  seeded: boolean;
  seedInfo?: { customers: number; uniquePeople: number; exactDuplicates: number; lookalikes: number; deals: number };
  keenable?: { mode: "key" | "keyless" | "off"; queries: number; cached: number; errors: number };
  diskMode?: { mode: "shared" | "per-agent" | "mixed"; disks: number; ms: number; created: number; opened: number; note: string };
  worlds: WorldMeta[];
  agents: AgentState[];
  running: boolean;
  presets: Preset[];
  lastBisect?: BisectResult;
}

export interface Summary {
  agent: string;
  name: string;
  head: string;
  diff: WorldDiff;
}

// Calm categorical lane colors; "broken" is shown by red rings/chips, never by lane color.
const SWARM_COLORS = ["#2F7DD1", "#E07A1F", "#0F9E8E", "#8C6D3A", "#5B6B7F", "#C2477A", "#4C8A2A", "#6E59C9"];
const BASE_COLOR: Record<string, string> = { A: "var(--a)", B: "var(--b)", C: "var(--c)" };
export const AGENT_COLOR = new Proxy(BASE_COLOR, {
  get: (t, k: string) => t[k] ?? SWARM_COLORS[(Number(String(k).replace(/\D/g, "")) - 1 + SWARM_COLORS.length) % SWARM_COLORS.length],
});

export function ms(n?: number) {
  if (n === undefined) return "";
  return n < 10 ? `${n.toFixed(1)} ms` : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`;
}

export function App() {
  const [st, setSt] = useState<AppState | null>(null);
  const [from, setFrom] = useState("base");
  const [to, setTo] = useState("");
  const [diff, setDiff] = useState<WorldDiff | null>(null);
  const [diffErr, setDiffErr] = useState("");
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [sel, setSel] = useState<string>("");
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [ticker, setTicker] = useState<Record<string, ToolCall>>({});
  const [bisectOpen, setBisectOpen] = useState<boolean | string>(false);
  const [bisectLive, setBisectLive] = useState<(BisectResult & { phase?: string }) | null>(null);
  const [mode, setMode] = useState<"scripted" | "llm">("scripted");
  const [swarm, setSwarm] = useState(0);
  const [rewind, setRewind] = useState(false);
  const [incident, setIncident] = useState<string | null>(null);
  const [page, setPage] = useState<ClassicPage>(pageFromHash);
  useEffect(() => {
    history.replaceState(null, "", `${location.pathname}${location.search}${page === "dashboard" ? "" : `#${page}`}`);
  }, [page]);
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem("delta-theme") ?? "light";
    } catch {
      return "light";
    }
  });
  const wasRunning = useRef(false);

  useEffect(() => {
    // Light only: the product ships a single light theme, regardless of the OS setting.
    document.documentElement.dataset.theme = "light";
  }, [theme]);

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 2600);
  };

  const loadState = useCallback(async () => {
    try {
      setSt(await api<AppState>("/api/state"));
    } catch {
      /* server restarting */
    }
  }, []);
  const loadSummaries = useCallback(async () => {
    try {
      setSummaries(await api<Summary[]>("/api/summaries"));
    } catch {
      setSummaries([]); // worlds can vanish under us during a reset; the next state event reloads
    }
  }, []);

  useEffect(() => {
    loadState();
    loadSummaries();
    const es = new EventSource("/api/events");
    es.addEventListener("state", (e) => setSt(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("agent", (e) => {
      const a: AgentState = JSON.parse((e as MessageEvent).data);
      setSt((s) => (s ? { ...s, agents: s.agents.map((x) => (x.id === a.id ? a : x)) } : s));
    });
    es.addEventListener("world", (e) => {
      const w: WorldMeta = JSON.parse((e as MessageEvent).data);
      setSt((s) => (s ? { ...s, worlds: [...s.worlds.filter((x) => x.id !== w.id), w] } : s));
    });
    es.addEventListener("call", (e) => {
      const { agent, call } = JSON.parse((e as MessageEvent).data);
      setTicker((t) => ({ ...t, [agent]: call }));
    });
    es.addEventListener("bisect", (e) => setBisectLive(JSON.parse((e as MessageEvent).data)));
    return () => es.close();
  }, [loadState, loadSummaries]);

  useEffect(() => {
    if (st?.backend.kind !== "archil") return;
    const t = setInterval(loadState, 5000);
    return () => clearInterval(t);
  }, [st?.backend.kind, loadState]);

  const heads = useMemo(() => {
    const h: Record<string, string> = {};
    for (const w of st?.worlds ?? []) if (w.agent && w.kind === "checkpoint" && (!h[w.agent] || (w.step ?? 0) > Number(h[w.agent].split("@")[1]))) h[w.agent] = w.id;
    for (const a of st?.agents ?? []) if (a.rolledBackTo !== undefined && h[a.id]) h[a.id] = a.rolledBackTo === 0 ? "base" : `${a.id}@${a.rolledBackTo}`;
    return h;
  }, [st?.worlds, st?.agents]);

  // When a run finishes: refresh summaries and point the comparison at the most interesting agent.
  useEffect(() => {
    if (!st) return;
    if (wasRunning.current && !st.running) {
      loadSummaries();
      setTicker({});
      if (heads.B) {
        setFrom("base");
        setTo(heads.B);
      }
    }
    if (!to && !st.running && heads.B) setTo(heads.B);
    if (to && !st.worlds.some((w) => w.id === to)) setTo("");
    wasRunning.current = st.running;
  }, [st, heads, to, loadSummaries]);

  useEffect(() => {
    const known = (id: string) => !!st?.worlds.some((w) => w.id === id);
    if (!to || !from || from === to || st?.running || !known(from) || !known(to)) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    setDiffErr("");
    api<WorldDiff>(`/api/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((d) => {
        if (cancelled) return;
        setDiff(d);
        setSel((cur) => (d.files.some((f) => f.path === cur) ? cur : d.files[0]?.path ?? ""));
      })
      .catch((e) => !cancelled && setDiffErr(String(e.message)))
      .finally(() => !cancelled && setLoadingDiff(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, st?.running, st?.worlds.length]);

  if (!st) return <div className="empty">Loading Bites the Data…</div>;

  const worldById = new Map(st.worlds.map((w) => [w.id, w]));
  const toMeta = worldById.get(to);
  const stepPair = toMeta?.parent === from ? toMeta : undefined;
  const selected = diff?.files.find((f) => f.path === sel);

  const seed = async () => {
    try {
      await api("/api/seed", { method: "POST" });
      setSummaries([]);
      setTo("");
      flash("Seeded a fresh base world");
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const run = async () => {
    try {
      setSummaries([]);
      await api("/api/run", { method: "POST", body: JSON.stringify({ mode, swarm }) });
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const compare = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };
  const rollback = async (world: string) => {
    try {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) {
        setRewind(true);
        setTimeout(() => setRewind(false), 650);
      }
      const r = await api<{ agent: AgentState; result: { ms: number; restoreMs: number; ref?: string; written: number } }>("/api/rollback", { method: "POST", body: JSON.stringify({ world }) });
      const how = r.result.ref ? `Archil branch ${r.result.ref} in ${ms(r.result.ms)}` : `APFS clone in ${ms(r.result.ms)}`;
      flash(`Rolled ${r.agent.id} back to ${world}: ${how}, ${r.result.written} files restored`);
      await loadState();
      await loadSummaries();
      compare("base", world);
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const rollForward = async (agent: string) => {
    try {
      await api("/api/rollforward", { method: "POST", body: JSON.stringify({ agent }) });
      await loadState();
      await loadSummaries();
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const forkRun = async (world: string, variant: string) => {
    try {
      flash(`Branching ${world}…`);
      const r = await api<{ agent: AgentState; head: string; branchRef?: string; branchMs: number }>("/api/fork-run", {
        method: "POST",
        body: JSON.stringify({ world, variant }),
      });
      const how = r.branchRef ? `Archil branch in ${ms(r.branchMs)}` : `APFS clone in ${ms(r.branchMs)}`;
      flash(`Forked ${world} (${how}); ${variant} ran ${r.agent.stepsDone} steps`);
      await loadState();
      await loadSummaries();
      const src = world.split("@")[0];
      const rogueEnd = (st?.worlds ?? []).filter((w) => w.agent === src && w.kind === "checkpoint").sort((x, y) => (y.step ?? 0) - (x.step ?? 0))[0]?.id;
      compare(rogueEnd ?? "base", r.head);
      const d = await api<WorldDiff>(`/api/diff?from=base&to=${encodeURIComponent(r.head)}`);
      const lost = Math.max(0, ...d.files.map((f) => f.stats.rowsLost ?? 0));
      const removed = Math.max(0, ...d.files.filter((f) => f.kind === "csv").map((f) => f.stats.rowsRemoved ?? 0));
      setTimeout(() => flash(`Fixed: ${r.head} vs base — ${lost} customers lost · ${removed - lost} merged`), 2700);
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const fork = async (world: string) => {
    try {
      const w = await api<WorldMeta>("/api/fork", { method: "POST", body: JSON.stringify({ world }) });
      flash(w.branchRef ? `Forked ${world}: Archil branch ${w.branchRef} in ${ms(w.snapshotMs)}` : `Forked ${world}: APFS clone in ${ms(w.snapshotMs)}`);
      await loadState();
      compare("base", w.id);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const bisectFor = st.lastBisect;
  const anyCheckpoint = Object.keys(heads).length > 0;

  const ctx = {
    st, from, to, setFrom, setTo, compare, diff, diffErr, loadingDiff, sel, setSel, selected, summaries, ticker, heads, stepPair,
    bisectLive, setBisectLive, loadState, loadSummaries, rollback, rollForward, fork, seed, run, mode, setMode, swarm, setSwarm,
    theme, setTheme, rewind, toast, anyCheckpoint,
  };
  // The experimental single-pane dashboard is kept at /app?v2=1; the classic dashboard (+ icon rail) is the main page.
  if (new URLSearchParams(window.location.search).has("v2")) return <Dashboard ctx={ctx} />;

  return (
    <div className="shell">
    <Rail page={page} onPage={setPage} />
    <div className="app">
      <header className="header">
        <a href="/" className="brand-name" title="Home" data-testid="brand-home">
          Bites the Data
        </a>
        <div className="spacer" />
        <span
          className="live"
          title={st.backend.error ?? (st.backend.kind === "archil" ? "Running on Archil — each agent has its own disk" : "Running offline (local copies)")}
          data-testid="live"
        >
          <span className="live-dot" /> Live
        </span>
        <div className="seg" role="radiogroup" aria-label="Agents">
          {[
            [0, "3 agents"],
            [8, "8 agents"],
          ].map(([n, label]) => (
            <button
              key={n}
              role="radio"
              aria-checked={swarm === n}
              className={`seg-b ${swarm === n ? "on" : ""}`}
              onClick={() => setSwarm(n as number)}
              disabled={st.running}
              data-testid={`swarm-${n}`}
              title={n ? "Swarm: 8 agent variants, one review" : "Formatter, Merger and Enricher"}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={seed} disabled={st.running} title="Start again from the original data">
          Reset
        </button>
        <button className="btn primary" onClick={run} disabled={st.running} data-testid="run" title="Run the agents; Archil saves a checkpoint after every step">
          {st.running ? "Running…" : "Run agents"}
        </button>
      </header>

      <div className={`body ${page === "dashboard" ? "" : "no-sidebar"}`}>
        {page === "dashboard" && (
        <VersionsSidebar st={st} from={from} to={to} setFrom={setFrom} compare={compare} rollback={rollback} fork={fork} forkRun={forkRun} bisectFor={bisectFor} onIncident={setIncident} />
        )}

        <main className={`main ${rewind ? "rewind" : ""}`}>
          {page !== "dashboard" ? (
            <PageHost
              ctx={ctx}
              page={page}
              onPage={setPage}
              onCompare={(f, t) => { compare(f, t); setPage("dashboard"); }}
              onDetails={(agent, broken) => {
                if (heads[agent]) compare("base", heads[agent]);
                setPage("dashboard");
                if (broken) setIncident(agent);
              }}
            />
          ) : (
          <>
          <PageIntro page="dashboard" />
          <AgentCards agents={st.agents} worlds={st.worlds} keenable={st.keenable?.mode ?? "off"} summaries={summaries} ticker={ticker} active={to} heads={heads} onPick={(h) => compare("base", h)} onRollForward={rollForward} onIncident={setIncident} />
          {anyCheckpoint && !st.running && <Review key={`${st.worlds.length}|${st.agents.map((a) => `${a.id}:${a.status}:${a.rolledBackTo ?? ""}`).join()}`} onBisect={(agent) => setBisectOpen(agent)} onCompare={compare} onIncident={setIncident} />}

          {!st.seeded || !anyCheckpoint ? (
            <div className="card empty">
              <h2>{st.running ? "Agents are working…" : "Three agents, one shared starting world"}</h2>
              <p>
                {st.running
                  ? "Each agent forked the base world and checkpoints after every step. Diffs open when they finish."
                  : `The base world holds customers.csv (${fmt(st.seedInfo?.customers ?? 5000)} rows), crm.sqlite, config.json and notes. Run the agents: each forks the world and checkpoints after every step.`}
              </p>
              {!st.running && (
                <button className="btn primary" onClick={run}>
                  Run agents
                </button>
              )}
            </div>
          ) : (
            <section className="report" data-testid="report">
              <div className="rep-pick">
                <span className="rep-lbl">Compare</span>
                <VersionChip worlds={st.worlds} value={from} onChange={setFrom} testid="from" />
                <span className="rep-arrow">→</span>
                <VersionChip worlds={st.worlds} value={to} onChange={setTo} testid="to" />
                <button className="btn sm ghost" onClick={() => compare(to, from)} disabled={!to} title="Swap">
                  ⇄ Swap
                </button>
                <div className="quick">
                  {st.agents.map((a) =>
                    heads[a.id] ? (
                      <button key={a.id} className="btn sm" onClick={() => compare("base", heads[a.id])} data-testid={`quick-${a.id}`}>
                        <span className="swatch" style={{ background: AGENT_COLOR[a.id] }} />
                        base → {a.id} end
                      </button>
                    ) : null,
                  )}
                  {toMeta?.parent && toMeta.parent !== from && (
                    <button className="btn sm" onClick={() => compare(toMeta.parent!, to)}>
                      previous step → this step
                    </button>
                  )}
                </div>
              </div>
              {!to || from === to ? (
                <div className="empty">Pick two versions above, or click a step in VERSIONS.</div>
              ) : (
                <>
                  {diff && <ReportSummary d={diff} st={st} from={from} to={to} />}
                  {loadingDiff && !diff && <div className="faint">Diffing…</div>}
                  {diffErr && <div className="err">{diffErr}</div>}
                  {stepPair && stepPair.kind === "checkpoint" && <StepTrace w={stepPair} onRollback={rollback} onFork={fork} disabled={st.running} />}
                  {diff && diff.files.length === 0 && <div className="empty">No differences. The two versions are identical.</div>}
                  {diff && diff.files.length > 0 && (
                    <div className="card rep-files">
                      <div className="ftabs" role="tablist">
                        {diff.files.map((f) => (
                          <button key={f.path} role="tab" aria-selected={f.path === sel} className={`ftab ${f.path === sel ? "on" : ""}`} onClick={() => setSel(f.path)} data-testid={`file-${f.path}`} title={`${f.path}: ${f.summary}`}>
                            <span className={`st ${f.status}`}>{f.status[0].toUpperCase()}</span>
                            <span className="ftab-n">{f.path}</span>
                            {f.flags.some((x) => x.level === "warn") && <span className="ftab-w" aria-label="warning" />}
                          </button>
                        ))}
                      </div>
                      {selected ? <FileDetailView key={`${from}|${to}|${selected.path}`} from={from} to={to} fc={selected} /> : <div className="empty">Select a file</div>}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          </>
          )}
        </main>
      </div>

      {bisectOpen && (
        <BisectModal
          agents={st.agents.filter((a) => heads[a.id])}
          initialAgent={typeof bisectOpen === "string" ? bisectOpen : undefined}
          presets={st.presets}
          worlds={st.worlds}
          live={bisectLive}
          onClose={() => setBisectOpen(false)}
          onRollback={(w) => {
            setBisectOpen(false);
            rollback(w);
          }}
          onShow={(f, t) => {
            compare(f, t);
            setBisectOpen(false);
          }}
          onRun={async (agent, invariant) => {
            setBisectLive({ agent, invariant, checks: [], verdict: "error", bisectChecks: 0, totalSteps: 0, phase: "start" });
            const r = await api<BisectResult>("/api/bisect", { method: "POST", body: JSON.stringify({ agent, invariant }) });
            setBisectLive({ ...r, phase: "done" });
            loadState();
          }}
        />
      )}
      {incident && (
        <IncidentDrawer
          agent={incident}
          flash={flash}
          onClose={() => setIncident(null)}
          onRollback={(w) => {
            setIncident(null);
            rollback(w);
          }}
          onFix={(w, v) => {
            setIncident(null);
            forkRun(w, v);
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
    </div>
  );
}

export function WorldSelect({ worlds, value, onChange, testid }: { worlds: WorldMeta[]; value: string; onChange: (v: string) => void; testid: string }) {
  const groups = new Map<string, WorldMeta[]>();
  for (const w of worlds) if (w.agent && w.kind === "checkpoint") groups.set(w.agent, [...(groups.get(w.agent) ?? []), w]);
  return (
    <select className="sel mono" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
      {!value && <option value="">choose…</option>}
      <option value="base">base</option>
      {[...groups].map(([agent, ws]) => (
        <optgroup key={agent} label={`Agent ${agent}`}>
          {ws
            .sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.id} · {w.stepName}
              </option>
            ))}
        </optgroup>
      ))}
          {worlds.some((w) => w.kind === "fork") && (
        <optgroup label="Forks">
          {worlds.filter((w) => w.kind === "fork").map((w) => (
            <option key={w.id} value={w.id}>{w.id} · {w.label}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export function Totals({ d }: { d: WorldDiff }) {
  const t = d.totals;
  const parts: [string, number][] = [
    ["modified", t.filesModified],
    ["added", t.filesAdded],
    ["removed", t.filesRemoved],
    ["renamed", t.filesRenamed],
  ];
  return (
    <div className="totals">
      {parts.filter(([, n]) => n).map(([k, n]) => (
        <span key={k}>
          <b>{n}</b> {k}
        </span>
      ))}
      <span>
        <b>{d.unchanged}</b> unchanged
      </span>
      <span className="faint">{d.ms} ms</span>
    </div>
  );
}

const STATUS_LETTER = { modified: "M", added: "A", removed: "D", renamed: "R" } as const;

export function FileRow({ f, sel, onClick }: { f: FileChange; sel: boolean; onClick: () => void }) {
  const warn = f.flags.find((x) => x.level === "warn");
  return (
    <div className={`file ${sel ? "sel" : ""}`} onClick={onClick} data-testid={`file-${f.path}`}>
      <span className={`st ${f.status}`}>{STATUS_LETTER[f.status]}</span>
      <span className="p">
        {f.path}
        <span className="kind">{f.kind}</span>
      </span>
      <span className="s">{f.summary}</span>
      {warn && (
        <span className="w">
          <WarnIcon size={12} />
          {warn.text.replace(/^[^:]+:\s*/, "")}
        </span>
      )}
    </div>
  );
}

export function StepTrace({ w, onRollback, onFork, disabled }: { w: WorldMeta; onRollback: (id: string) => void; onFork: (id: string) => void; disabled: boolean }) {
  return (
    <div className="card">
      <div className="trace">
        <div className="row">
          <span className="swatch" style={{ background: AGENT_COLOR[w.agent ?? ""] }} />
          <b>
            Agent {w.agent}, step {w.step}: {w.stepName}
          </b>
          <span className="faint mono">
            step {ms(w.stepMs)} · checkpoint {ms(w.snapshotMs)}
            {w.ref ? ` · ${w.ref}` : ""}
          </span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => onRollback(w.id)} disabled={disabled} data-testid="trace-rollback">
            Roll back {w.agent} to step {w.step}
          </button>
          <button className="btn sm" onClick={() => onFork(w.id)} disabled={disabled} data-testid="trace-fork">
            Fork from here
          </button>
        </div>
        {w.thought && <div className="thought">{w.thought}</div>}
        {(w.calls ?? []).map((c, i) => (
          <div className="call" key={i}>
            <span className="tool">{c.tool}</span>
            <span className="in" title={c.input}>
              {c.input}
            </span>
            <span className="out">
              {c.output} · {ms(c.ms)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function headlineFor(s?: Summary): { text: string; bad: boolean; facts: string[] } {
  if (!s) return { text: "", bad: false, facts: [] };
  const files = s.diff.files;
  const csvs = files.filter((f) => f.kind === "csv" && f.status === "modified");
  const lost = Math.max(0, ...files.map((f) => f.stats.rowsLost ?? 0));
  const lostFile = [...files].sort((a, b) => (a.kind === "csv" ? -1 : 1) - (b.kind === "csv" ? -1 : 1)).find((f) => (f.stats.rowsLost ?? 0) === lost && lost > 0);
  const shifts = Math.max(0, ...files.map((f) => f.stats.magnitudeShifts ?? 0));
  const main = csvs.sort((a, b) => (b.stats.cellsChanged ?? 0) - (a.stats.cellsChanged ?? 0))[0];
  const facts: string[] = [];
  let text: string;
  let bad = false;
  if (lost > 0) {
    const noun = (lostFile?.path ?? "rows").replace(/\.(csv|sqlite)$/, "").split("/").pop();
    text = `${fmt(lost)} ${noun} deleted`;
    bad = true;
    const merged = (lostFile?.stats.rowsRemoved ?? 0) - lost;
    facts.push(`no surviving duplicate${merged > 0 ? `; ${fmt(merged)} true dupes merged` : ""}`);
  } else if (shifts > 0) {
    text = `${fmt(shifts)} deal amounts corrupted ≥10x`;
    bad = true;
    if (main && (main.stats.rowsRemoved ?? 0) > 0) facts.push(`${fmt(main.stats.rowsRemoved ?? 0)} duplicates merged, no customers lost`);
  } else if (main && (main.stats.rowsRemoved ?? 0) > 0) {
    text = `${fmt(main.stats.rowsRemoved ?? 0)} duplicates merged`;
    facts.push(`${fmt(main.stats.rowsAfter ?? 0)} rows, no customers lost`);
  } else if (main && (main.stats.columnsAdded ?? 0) > 0) {
    text = `${main.stats.columnsAdded} column${main.stats.columnsAdded === 1 ? "" : "s"} added`;
    facts.push(`${fmt(main.stats.cellsFilled ?? 0)} empty cells filled`);
  } else if (main) {
    text = `${fmt(main.stats.cellsChanged ?? 0)} cells changed`;
    facts.push(`in ${fmt(main.stats.rowsChanged ?? 0)} rows of ${main.path}`);
  } else text = `${files.length} files changed`;
  if (shifts > 0 && lost > 0) {
    bad = true;
    facts.push(`${fmt(shifts)} deal amounts changed ≥10x`);
  }
  const touched = files.filter((f) => f.kind === "json" && f.status === "modified").map((f) => f.path);
  if (touched.length) facts.push(`touched ${touched.join(", ")}`);
  facts.push(`${files.length} files changed`);
  return { text, bad, facts };
}

export function AgentCards({
  agents, summaries, ticker, active, heads, onPick,
  onRollForward,
  worlds,
  keenable,
  onIncident,
}: { worlds: WorldMeta[]; keenable: string; agents: AgentState[]; summaries: Summary[]; ticker: Record<string, ToolCall>; active: string; heads: Record<string, string>; onPick: (head: string) => void; onRollForward: (agent: string) => void; onIncident?: (agent: string) => void }) {
  if (!agents.length) return null;
  return (
    <div className="cards">
      {agents.map((a) => {
        const s = summaries.find((x) => x.agent === a.id);
        const h = headlineFor(s);
        const pct = a.stepsTotal ? Math.round((a.stepsDone / a.stepsTotal) * 100) : 0;
        const call = ticker[a.id];
        return (
          <div
            key={a.id}
            className={`card acard ${heads[a.id] && active === heads[a.id] ? "active" : ""}`}
            style={{ ["--sw" as string]: AGENT_COLOR[a.id] }}
            onClick={() => heads[a.id] && onPick(heads[a.id])}
            data-testid={`card-${a.id}`}
          >
            <div className="top">
              <span className="nm">
                {a.id} · {a.name}
              </span>
              <span className="status">
                {a.status === "running" ? `step ${a.stepsDone + 1}/${a.stepsTotal}` : a.status === "done" ? `${a.stepsDone} checkpoints` : a.status}
              </span>
            </div>
            <div className="role">{a.role}</div>
            {/Enricher/.test(a.name) && <KeenableBadge calls={worlds.filter((w) => w.agent === a.id).flatMap((w) => w.calls ?? []).filter((c) => c.tool === "web_search")} mode={keenable} />}
            {a.rolledBackTo !== undefined && a.rollback && (
              <div className="rb" data-testid={`rolled-${a.id}`}>
                Rolled back to step {a.rolledBackTo} · {a.rollback.ref ? `Archil branch in ${ms(a.rollback.ms)}` : `APFS clone in ${ms(a.rollback.ms)}`}
                <button className="mini" onClick={(e) => { e.stopPropagation(); onRollForward(a.id); }}>Undo</button>
              </div>
            )}
            {a.status === "running" || !s ? (
              <>
                <div className="progress">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="ticker">
                  {a.status === "running" && call ? (
                    <>
                      <span className="tool">{call.tool}</span> {call.input}
                    </>
                  ) : a.status === "error" ? (
                    <span className="err">{a.error}</span>
                  ) : a.status === "done" ? (
                    "summarizing…"
                  ) : (
                    <span className="faint">waiting to run</span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className={`headline ${h.bad ? "bad" : "good"}`}>
                  {h.bad && <WarnIcon size={16} />}
                  {h.text}
                </div>
                <div className="facts">
                  {h.facts.map((f) => (
                    <span key={f}>{f}</span>
                  ))}
                </div>
                {onIncident && (
                  h.bad ? (
                    <button className="card-link bad" onClick={(e) => { e.stopPropagation(); onIncident(a.id); }} data-testid={`wrong-${a.id}`}>
                      See what went wrong →
                    </button>
                  ) : (
                    <button className="card-link ok" onClick={(e) => { e.stopPropagation(); if (heads[a.id]) onPick(heads[a.id]); }}>
                      ✓ Clean — see changes
                    </button>
                  )
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StatsStrip({ s, disk, keenable }: { s: NonNullable<AppState["backend"]["stats"]>; disk?: AppState["diskMode"]; keenable?: AppState["keenable"] }) {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  // Archil list prices: serverless tool calls $0.05 per 1,000 (execution included); no sandbox compute used.
  const cost = s.execCalls * 0.00005;
  return (
    <div className="stats" data-testid="archil-stats">
      <span className="stats-t">Zero sandboxes</span>
      <span>agent loops run in this host process; disk work goes straight to Archil (object API + 1 serverless exec per checkpoint)</span>
      <span className="stats-t">This session</span>
      <span><b>{s.checkpoints}</b> checkpoints</span>
      <span><b>{s.branches}</b> branches</span>
      <span><b>{s.execCalls}</b> exec calls</span>
      <span title="GetObject with versionId=<checkpoint>; repeat reads are served from Delta's content-addressed cache"><b>{s.checkpointReads}</b> cold checkpoint reads · <b>{mb(s.bytesReadFromCheckpoints)}</b></span>
      <span><b>{s.objectWrites}</b> object writes · <b>{mb(s.bytesWritten)}</b></span>
      <span className="faint">est. cost <b>${cost.toFixed(4)}</b> (exec $0.05/1k)</span>
      {disk && (
        <span data-testid="disk-mode" title={disk.note}>
          <b>{disk.mode === "per-agent" ? "1 disk per agent" : disk.mode === "mixed" ? `${disk.disks} disks (mixed)` : "1 shared disk"}</b>
          {disk.mode !== "shared" ? ` · ${disk.opened} opened, ${disk.created} created in ${disk.ms} ms` : ""}
          {disk.mode !== "per-agent" ? <span className="faint"> · {disk.note}</span> : null}
        </span>
      )}
      {keenable && keenable.mode !== "off" && (
        <span>
          Keenable <b>{keenable.queries}</b> live · <b>{keenable.cached}</b> cached lookups
        </span>
      )}
    </div>
  );
}

interface ReviewRow {
  agent: string;
  name: string;
  head: string;
  ok: boolean;
  failed: { preset: string; label: string; value: string }[];
}

export function Review({ onBisect, onCompare, onIncident }: { onBisect: (agent: string) => void; onCompare: (from: string, to: string) => void; onIncident?: (agent: string) => void }) {
  const [r, setR] = useState<{ clean: number; broken: number; rows: ReviewRow[] } | null>(null);
  const [rogues, setRogues] = useState<{ agent: string; preset: string; firstBad?: string; stepName?: string; checks: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ busy?: boolean; clean: number; broken: number; rows: ReviewRow[] }>("/api/review").then((x) => !x.busy && setR(x)).catch(() => setR(null));
  }, []);
  if (!r || r.rows.length === 0) return null;
  const bad = r.rows.filter((x) => !x.ok);
  return (
    <div className="card review" data-testid="review">
      <div className="review-h">
        <span className="lbl">Review</span>
        <span>
          <b className="okc">{r.clean} clean</b> · <b className={r.broken ? "badc" : "faint"}>{r.broken} broke invariants</b>
          <span className="faint"> across {r.rows.length} agents</span>
        </span>
        <span className="spacer" />
        {bad.length > 0 && (
          <button
            className="btn sm"
            disabled={busy}
            data-testid="bisect-rogues"
            onClick={async () => {
              setBusy(true);
              try {
                setRogues(await api("/api/bisect-rogues", { method: "POST" }));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Bisecting…" : `Find the first bad step for all ${bad.length}`}
          </button>
        )}
      </div>
      {bad.length > 0 && (
        <div className="review-b">
          {bad.map((x) => (
            <div key={x.agent} className="rogue">
              <span className="swatch" style={{ background: AGENT_COLOR[x.agent] }} />
              <b>{x.agent}</b> <span className="muted">{x.name}</span>
              <span className="fails">
                {x.failed.map((f) => (
                  <span key={f.preset} className="ev vanished" title={f.value}>{f.label}</span>
                ))}
              </span>
              {rogues
                ?.filter((g) => g.agent === x.agent)
                .map((g) => (
                  <button key={g.preset} className="mini" onClick={() => { if (!g.firstBad) return; const k = Number(g.firstBad.split("@")[1]); onCompare(k > 1 ? `${x.agent}@${k - 1}` : "base", g.firstBad); }}>
                    step {g.firstBad?.split("@")[1]}: {g.stepName} ({g.checks} checks)
                  </button>
                ))}
              <span className="spacer" />
              {onIncident && <button className="mini" onClick={() => onIncident(x.agent)}>What went wrong</button>}
              <button className="mini" onClick={() => onBisect(x.agent)}>Bisect…</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function KeenableBadge({ calls, mode }: { calls: ToolCall[]; mode: string }) {
  if (mode === "off") return <div className="kb off" data-testid="keenable-badge">Keenable: not configured</div>;
  if (!calls.length) return <div className="kb" data-testid="keenable-badge">Keenable web search ready</div>;
  const cached = calls.filter((c) => c.output.includes("cached")).length;
  return (
    <div className="kb" data-testid="keenable-badge">
      via Keenable web search ({calls.length} lookups{cached ? `, ${cached} cached` : ""})
    </div>
  );
}

/** A version picker styled as a chip: agent color dot + step name. */
export function VersionChip({ worlds, value, onChange, testid }: { worlds: WorldMeta[]; value: string; onChange: (v: string) => void; testid: string }) {
  const w = worlds.find((x) => x.id === value);
  const color = w?.agent ? AGENT_COLOR[w.agent] : "var(--text)";
  return (
    <span className="vchip">
      <span className="vchip-dot" style={{ background: color }} />
      <WorldSelect worlds={worlds} value={value} onChange={onChange} testid={testid} />
    </span>
  );
}

function fmtN(n: number) {
  return n.toLocaleString("en-US");
}

/** Plain-English summary of a comparison plus big metric tiles. */
export function ReportSummary({ d, st, from, to }: { d: WorldDiff; st: AppState; from: string; to: string }) {
  const wTo = st.worlds.find((w) => w.id === to);
  const wFrom = st.worlds.find((w) => w.id === from);
  const agent = st.agents.find((a) => a.id === wTo?.agent);
  let subject = `${from} → ${to}`;
  if (agent && (from === "base" || wFrom?.agent === agent.id)) subject = `${agent.name}, steps ${from === "base" ? 1 : (wFrom?.step ?? 0) + 1}→${wTo?.step}`;
  else if (agent && wFrom?.agent) subject = `${st.agents.find((a) => a.id === wFrom.agent)?.name ?? from} → ${agent.name}`;
  const csvs = d.files.filter((f) => f.kind === "csv" && f.status === "modified");
  const main = [...csvs].sort((a, b) => (b.stats.rowsRemoved ?? 0) + (b.stats.cellsChanged ?? 0) - ((a.stats.rowsRemoved ?? 0) + (a.stats.cellsChanged ?? 0)))[0];
  const lost = main?.stats.rowsLost ?? 0;
  const removed = main?.stats.rowsRemoved ?? 0;
  const added = main?.stats.rowsAdded ?? 0;
  const cells = main?.stats.cellsChanged ?? 0;
  const noun = main ? main.path.replace(/\.csv$/, "").split("/").pop() : "rows";
  const facts: string[] = [];
  if (lost > 0) facts.push(`deleted ${fmtN(lost)} ${noun}`);
  if (removed - lost > 0) facts.push(`merged ${fmtN(removed - lost)} duplicates`);
  if (added > 0) facts.push(`${from !== "base" && wFrom?.agent && wFrom.agent !== wTo?.agent ? "restored" : "added"} ${fmtN(added)} ${noun}`);
  for (const h of d.highlights) {
    const m = h.text.match(/([\d,]+) (\w+) values changed by ≥10x \(median ([×÷])([\d.]+)\)/);
    const crossAgent = !!(wFrom?.agent && wTo?.agent && wFrom.agent !== wTo.agent);
    const what = m ? (m[2] === "amount" ? "deal amounts" : m[2]) : "";
    if (m) facts.push(crossAgent && m[3] === "×" ? `restored ${m[1]} ${what}` : `${m[3] === "÷" ? "divided" : "multiplied"} ${m[1]} ${what} by ${m[4]}`);
  }
  if (cells > 0 && lost === 0) facts.push(`changed ${fmtN(cells)} cells`);
  const cols = d.files.reduce((t, f) => t + (f.status === "modified" && f.kind === "csv" ? f.stats.columnsAdded ?? 0 : 0), 0);
  if (cols > 0) facts.push(`added ${cols} column${cols === 1 ? "" : "s"}`);
  const cfg = d.files.find((f) => f.kind === "json" && f.status === "modified");
  if (cfg) facts.push(`changed ${cfg.stats.pathsChanged ?? 0} config setting${cfg.stats.pathsChanged === 1 ? "" : "s"}`);
  if (!facts.length) facts.push(`changed ${d.files.length} file${d.files.length === 1 ? "" : "s"}`);
  const sentence = `${subject}: ${facts.slice(0, 4).join(", ")}.`;
  const delta = added - removed;
  return (
    <div className="rep-sum" data-testid="report-summary">
      <p className={`rep-sentence ${lost > 0 ? "bad" : ""}`}>{sentence}</p>
      <div className="rep-tiles">
        <div>
          <b className={delta < 0 ? "neg" : delta > 0 ? "pos" : ""}>{delta > 0 ? "+" : delta < 0 ? "−" : ""}{fmtN(Math.abs(delta))}</b>
          <span>rows{main ? ` in ${main.path}` : ""}</span>
        </div>
        <div className={lost > 0 ? "bad" : "ok"}>
          <b>{fmtN(lost)}</b>
          <span>customers lost</span>
        </div>
        <div>
          <b>{fmtN(d.totals.cellsChanged)}</b>
          <span>cells changed</span>
        </div>
        <div>
          <b>{d.files.length}</b>
          <span>files changed · {d.unchanged} unchanged</span>
        </div>
      </div>
    </div>
  );
}
