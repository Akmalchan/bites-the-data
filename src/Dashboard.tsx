// v2 dashboard: icon rail + pages (Overview, Compare, Bisect, History, Swarm). Presentation only:
// all state and actions come from App (ctx), so the classic layout at /app?classic=1 keeps working unchanged.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentState, BisectResult, FileChange, ToolCall, WorldDiff, WorldMeta } from "./types.ts";
import {
  AGENT_COLOR, AgentCards, FileRow, Review, StatsStrip, StepTrace, Totals, WorldSelect, ms,
  type AppState, type Summary,
} from "./App.tsx";
import { FileDetailView } from "./FileDetail.tsx";
import { BisectModal } from "./Bisect.tsx";
import { HistorySearch } from "./History.tsx";
import { LogoMark } from "./icons.tsx";
import { api } from "./util.ts";
import { NetworkView } from "./Network.tsx";
import { AgentAvatar, PAGE_LINES, PageArt } from "./PageArt.tsx";

export interface DashCtx {
  st: AppState;
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  compare: (f: string, t: string) => void;
  diff: WorldDiff | null;
  diffErr: string;
  loadingDiff: boolean;
  sel: string;
  setSel: (v: string) => void;
  selected?: FileChange;
  summaries: Summary[];
  ticker: Record<string, ToolCall>;
  heads: Record<string, string>;
  stepPair?: WorldMeta;
  bisectLive: (BisectResult & { phase?: string }) | null;
  setBisectLive: (v: (BisectResult & { phase?: string }) | null) => void;
  loadState: () => Promise<void>;
  loadSummaries: () => Promise<void>;
  rollback: (w: string) => Promise<void>;
  rollForward: (a: string) => Promise<void>;
  fork: (w: string) => Promise<void>;
  seed: () => Promise<void>;
  run: () => Promise<void>;
  mode: "scripted" | "llm";
  setMode: (m: "scripted" | "llm") => void;
  swarm: number;
  setSwarm: (n: number) => void;
  theme: string;
  setTheme: (t: string) => void;
  rewind: boolean;
  toast: string;
  anyCheckpoint: boolean;
}

type Page = "overview" | "compare" | "bisect" | "history" | "swarm";

export interface Rogue {
  ok: boolean;
  failed: string[];
  firstBad?: number;
  stepName?: string;
}

/** Review every agent's head and bisect the rogues (cheap: cached reads), so chips and the graph can say "broke at step 4". */
export function useRogues(st: AppState): Record<string, Rogue> {
  const [map, setMap] = useState<Record<string, Rogue>>({});
  const key = `${st.worlds.length}|${st.agents.map((a) => `${a.id}:${a.status}:${a.rolledBackTo ?? ""}`).join()}`;
  useEffect(() => {
    if (st.running || !st.worlds.some((w) => w.kind === "checkpoint")) return;
    let cancel = false;
    (async () => {
      try {
        const r = await api<{ busy?: boolean; rows: { agent: string; ok: boolean; failed: { label: string }[] }[] }>("/api/review");
        if (r.busy) return;
        const m: Record<string, Rogue> = {};
        for (const row of r.rows) m[row.agent] = { ok: row.ok, failed: row.failed.map((f) => f.label) };
        if (r.rows.some((x) => !x.ok)) {
          const b = await api<{ agent: string; firstBad?: string; stepName?: string }[]>("/api/bisect-rogues", { method: "POST" });
          for (const x of b) {
            const step = x.firstBad ? Number(x.firstBad.split("@")[1]) : undefined;
            const cur = m[x.agent];
            if (cur && step !== undefined && (cur.firstBad === undefined || step < cur.firstBad)) {
              cur.firstBad = step;
              cur.stepName = x.stepName;
            }
          }
        }
        if (!cancel) setMap(m);
      } catch {
        /* keep the previous view */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [key, st.running]);
  return map;
}

const ICONS: Record<Page, ReactNode> = {
  overview: <path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" />,
  compare: <path d="M6 3v14M14 3v14M3 7h6M11 13h6M4 10l2-3 2 3M12 10l2 3 2-3" />,
  bisect: <path d="M9 3a6 6 0 1 0 0 12A6 6 0 0 0 9 3zM13.5 13.5 18 18M9 6v6M6 9h6" />,
  history: <path d="M10 3a7 7 0 1 1-6.6 4.7M3 3v4h4M10 6v4l3 2" />,
  swarm: <path d="M5 5h.01M10 5h.01M15 5h.01M5 10h.01M10 10h.01M15 10h.01M5 15h.01M10 15h.01M15 15h.01" />,
};
const LABELS: Record<Page, string> = { overview: "Overview", compare: "Compare", bisect: "Bisect", history: "History", swarm: "Swarm" };

function Chip({ r, running }: { r?: Rogue; running?: boolean }) {
  if (running) return <span className="chip run">running</span>;
  if (!r) return <span className="chip">—</span>;
  if (r.ok) return <span className="chip ok">clean</span>;
  return <span className="chip bad">{r.firstBad !== undefined ? `broke at step ${r.firstBad}` : "broke a rule"}</span>;
}

export function Dashboard({ ctx }: { ctx: DashCtx }) {
  const { st } = ctx;
  const [page, setPage] = useState<Page>(() => (["overview", "compare", "bisect", "history", "swarm"].includes(location.hash.slice(1)) ? (location.hash.slice(1) as Page) : "overview"));
  useEffect(() => {
    history.replaceState(null, "", `${location.pathname}${location.search}#${page}`);
  }, [page]);
  const rogues = useRogues(st);
  const go = (p: Page) => setPage(p);
  const openCompare = (f: string, t: string) => {
    ctx.compare(f, t);
    setPage("compare");
  };

  return (
    <div className="v2">
      <nav className="rail" aria-label="Pages">
        <a className="rail-logo rail-home" href="/" data-tip="Home" aria-label="Home">
          <LogoMark size={30} />
        </a>
        {(Object.keys(LABELS) as Page[]).map((p) => (
          <button key={p} className={`rail-btn ${page === p ? "on" : ""}`} onClick={() => go(p)} data-tip={LABELS[p]} aria-label={LABELS[p]} data-testid={`nav-${p}`}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              {ICONS[p]}
            </svg>
          </button>
        ))}
      </nav>
      <div className="v2-main">
        <TopBar ctx={ctx} />
        {st.backend.kind === "archil" && st.backend.stats && <StatsStrip s={st.backend.stats} disk={st.diskMode} keenable={st.keenable} />}
        <div className={`v2-page ${ctx.rewind ? "main rewind" : ""}`}>
          {page === "overview" && <Overview ctx={ctx} rogues={rogues} onCompare={openCompare} go={go} />}
          {page === "compare" && <ComparePage ctx={ctx} rogues={rogues} />}
          {page === "bisect" && <BisectPage ctx={ctx} onCompare={openCompare} />}
          {page === "history" && <HistoryPage ctx={ctx} onCompare={openCompare} />}
          {page === "swarm" && <SwarmPage ctx={ctx} rogues={rogues} onCompare={openCompare} go={go} />}
        </div>
      </div>
      {ctx.toast && <div className="toast">{ctx.toast}</div>}
    </div>
  );
}

function TopBar({ ctx }: { ctx: DashCtx }) {
  const { st } = ctx;
  return (
    <header className="topbar">
      <div className="tb-brand">
        <a href="/" title="Home">Bites the Data</a> <span className="tb-tag">Neon for agent data, on Archil</span>
      </div>
      <span className="spacer" />
      <span className="tb-badge" title={st.backend.error ?? `${st.backend.label}: ${st.backend.detail}`}>
        <span className={`dot ${st.backend.kind === "archil" ? "archil" : "on"}`} />
        {st.backend.label}
        <span className="faint hide-sm">{st.backend.detail}</span>
      </span>
      <select className="sel sm" value={ctx.mode} onChange={(e) => ctx.setMode(e.target.value as "scripted" | "llm")} disabled={st.running} title="Agent mode">
        <option value="scripted">Scripted</option>
        <option value="llm" disabled={!st.llm.available}>Claude ({st.llm.model})</option>
      </select>
      <select className="sel sm" value={ctx.swarm} onChange={(e) => ctx.setSwarm(Number(e.target.value))} disabled={st.running} data-testid="swarm" title="Agents to fan out">
        <option value={0}>3 agents</option>
        <option value={8}>Swarm × 8</option>
        <option value={20}>Swarm × 20</option>
        <option value={50}>Swarm × 50</option>
      </select>
      <button className="btn sm" onClick={ctx.seed} disabled={st.running}>
        Reset world
      </button>
      <button className="btn sm primary" onClick={ctx.run} disabled={st.running} data-testid="run">
        {st.running ? "Running…" : "Run agents"}
      </button>
    </header>
  );
}

/* ------------------------------------------------------------------ Overview */

function Overview({ ctx, rogues, onCompare, go }: { ctx: DashCtx; rogues: Record<string, Rogue>; onCompare: (f: string, t: string) => void; go: (p: Page) => void }) {
  const { st } = ctx;
  if (!ctx.anyCheckpoint && !st.running) {
    return (
      <div className="card empty">
        <h2>Three agents, one shared starting world</h2>
        <p>Run the agents: each forks the base world and checkpoints after every step.</p>
        <button className="btn primary" onClick={ctx.run}>
          Run agents
        </button>
      </div>
    );
  }
  const compact = st.agents.length > 6;
  return (
    <div className="ov">
      <div className="ov-h">
        <h1>Overview</h1>
        <span className="muted">
          {st.agents.length} agents · {st.worlds.filter((w) => w.kind === "checkpoint").length} checkpoints
        </span>
      </div>
      <section className="card graph-card">
        <div className="sec-h">
          <h2>Network</h2>
          <span className="faint">every dot is a checkpoint · click one to see what that step changed</span>
        </div>
        <Graph ctx={ctx} rogues={rogues} onPick={onCompare} />
      </section>
      {!compact && (
        <AgentCards
          agents={st.agents}
          worlds={st.worlds}
          keenable={st.keenable?.mode ?? "off"}
          summaries={ctx.summaries}
          ticker={ctx.ticker}
          active={ctx.to}
          heads={ctx.heads}
          onPick={(h) => onCompare("base", h)}
          onRollForward={ctx.rollForward}
        />
      )}
      {!st.running && ctx.anyCheckpoint && (
        <Review key={`${st.worlds.length}|${st.agents.map((a) => `${a.id}:${a.status}:${a.rolledBackTo ?? ""}`).join()}`} onBisect={() => go("bisect")} onCompare={onCompare} />
      )}
    </div>
  );
}

function Graph({ ctx, rogues, onPick }: { ctx: DashCtx; rogues: Record<string, Rogue>; onPick: (f: string, t: string) => void }) {
  const { st } = ctx;
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const forks = st.worlds.filter((w) => w.kind === "fork");
  const lanes: { key: string; label: string; agent?: AgentState; fork?: WorldMeta }[] = [
    ...st.agents.map((a) => ({ key: a.id, label: `${a.id} · ${a.name}`, agent: a })),
    ...forks.map((f) => ({ key: f.id, label: `fork of ${f.forkOf}`, fork: f })),
  ];
  const n = lanes.length;
  const laneH = n > 20 ? 16 : n > 8 ? 24 : 40;
  const r = n > 20 ? 3.5 : n > 8 ? 5 : 7;
  const maxSteps = Math.max(1, ...st.agents.map((a) => Math.max(a.stepsTotal, a.stepsDone)));
  const labelW = 270;
  const W = 1400;
  const x0 = labelW + 30;
  const dx = Math.min(80, (W - x0 - 40) / maxSteps);
  const top = 30;
  const H = top + n * laneH + 20;
  const baseY = top - 10;
  const xOf = (step: number) => x0 + step * dx;
  const yOf = (i: number) => top + i * laneH + laneH / 2;

  const dots: ReactNode[] = [];
  const lines: ReactNode[] = [];
  const labels: ReactNode[] = [];
  lanes.forEach((lane, i) => {
    const y = yOf(i);
    if (lane.agent) {
      const a = lane.agent;
      const color = AGENT_COLOR[a.id];
      const steps = st.worlds.filter((w) => w.agent === a.id && w.kind === "checkpoint").sort((p, q) => (p.step ?? 0) - (q.step ?? 0));
      const last = steps.length ? steps[steps.length - 1].step ?? 0 : 0;
      const rb = a.rolledBackTo;
      const bad = rogues[a.id]?.firstBad;
      lines.push(<path key={`b${a.id}`} d={`M${xOf(0)},${baseY} C${xOf(0)},${y} ${xOf(0)},${y} ${xOf(0) + Math.min(dx, 30)},${y}`} stroke={color} strokeWidth={2} fill="none" />);
      if (last > 0) {
        const solidEnd = rb !== undefined ? rb : last;
        lines.push(<line key={`l${a.id}`} x1={xOf(0) + Math.min(dx, 30)} y1={y} x2={xOf(Math.max(solidEnd, 1))} y2={y} stroke={color} strokeWidth={2} />);
        if (rb !== undefined && rb < last) lines.push(<line key={`u${a.id}`} x1={xOf(rb)} y1={y} x2={xOf(last)} y2={y} stroke={color} strokeWidth={1.5} strokeDasharray="3 4" opacity={0.4} />);
      }
      for (const w of steps) {
        const s = w.step ?? 0;
        const isBad = bad === s;
        const undone = rb !== undefined && s > rb;
        dots.push(
          <circle
            key={w.id}
            cx={xOf(s)}
            cy={y}
            r={isBad ? r + 2 : r}
            className={`gdot ${isBad ? "bad" : ""} ${ctx.to === w.id ? "sel" : ""}`}
            fill={isBad ? "#fff" : undone ? "var(--panel)" : color}
            stroke={isBad ? "#D7263D" : color}
            strokeWidth={isBad ? 3.5 : 2}
            opacity={undone ? 0.45 : 1}
            data-testid={`gdot-${w.id}`}
            onClick={() => onPick(w.parent ?? "base", w.id)}
            onMouseEnter={() => setHover({ x: xOf(s), y, text: `${w.id} · ${w.stepName}${isBad ? " · first bad step" : ""}` })}
            onMouseLeave={() => setHover(null)}
          />,
        );
      }
      if (bad !== undefined && laneH >= 24) dots.push(<text key={`bad${a.id}`} x={xOf(bad)} y={y - r - 7} textAnchor="middle" className="glabel badl">first bad</text>);
      if (rb !== undefined) dots.push(<text key={`rb${a.id}`} x={xOf(rb)} y={y - r - 4} textAnchor="middle" className="glabel accent">↺ head</text>);
      if (a.status === "running") dots.push(<circle key={`run${a.id}`} cx={xOf((a.stepsDone ?? 0) + 1)} cy={y} r={r} fill="none" stroke={color} strokeDasharray="2 2" className="gpulse" />);
      labels.push(
        <g key={`lab${a.id}`} className="glab" onClick={() => ctx.heads[a.id] && onPick("base", ctx.heads[a.id])}>
          <circle cx={10} cy={y} r={4} fill={color} />
          <text x={20} y={y + 4} className="gname">
            {lane.label.length > 24 ? lane.label.slice(0, 23) + "…" : lane.label}
          </text>
          {laneH >= 24 && (
            <text x={labelW - 6} y={y + 4} textAnchor="end" className={`gchip ${rogues[a.id] ? (rogues[a.id].ok ? "ok" : "bad") : ""}`}>
              {a.status === "running" ? "running" : rogues[a.id] ? (rogues[a.id].ok ? "clean" : rogues[a.id].firstBad !== undefined ? `broke @${rogues[a.id].firstBad}` : "broke") : ""}
            </text>
          )}
        </g>,
      );
    } else if (lane.fork) {
      const f = lane.fork;
      const src = st.worlds.find((w) => w.id === f.forkOf);
      const si = lanes.findIndex((l) => l.agent?.id === src?.agent);
      const sx = xOf(src?.step ?? 0);
      const sy = si >= 0 ? yOf(si) : baseY;
      lines.push(<path key={`f${f.id}`} d={`M${sx},${sy} C${sx},${y} ${sx},${y} ${sx + dx * 0.6},${y}`} stroke="var(--violet)" strokeWidth={2} fill="none" />);
      dots.push(
        <rect
          key={f.id}
          x={sx + dx * 0.6 - r}
          y={y - r}
          width={r * 2}
          height={r * 2}
          rx={2}
          fill="var(--violet)"
          className="gdot"
          onClick={() => onPick("base", f.id)}
          onMouseEnter={() => setHover({ x: sx + dx * 0.6, y, text: `${f.id} · ${f.branchRef ? `Archil branch ${f.branchRef}` : "APFS clone"}` })}
          onMouseLeave={() => setHover(null)}
        />,
      );
      labels.push(
        <text key={`lab${f.id}`} x={20} y={y + 4} className="gname faint">
          ⑂ {lane.label}
        </text>,
      );
    }
  });
  const ticks = Array.from({ length: maxSteps + 1 }, (_, s) => (
    <text key={s} x={xOf(s)} y={H - 4} textAnchor="middle" className="gtick">
      {s === 0 ? "base" : s}
    </text>
  ));
  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="graph" data-testid="graph" role="img" aria-label="Checkpoint network graph">
        {Array.from({ length: maxSteps + 1 }, (_, s) => (
          <line key={s} x1={xOf(s)} x2={xOf(s)} y1={top - 4} y2={H - 16} className="ggrid" />
        ))}
        <circle cx={xOf(0)} cy={baseY} r={r + 1} fill="var(--text)" />
        <text x={xOf(0) + r + 6} y={baseY + 4} className="gname">
          base
        </text>
        {lines}
        {labels}
        {dots}
        {ticks}
      </svg>
      {hover && (
        <div className="gtip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Compare */

function ComparePage({ ctx, rogues }: { ctx: DashCtx; rogues: Record<string, Rogue> }) {
  const { st } = ctx;
  const [treeOpen, setTreeOpen] = useState(true);
  return (
    <div className={`cmp ${treeOpen ? "" : "tree-closed"}`}>
      <aside className="tree card">
        <div className="tree-h">
          <span>Worlds</span>
          <button className="mini" onClick={() => setTreeOpen(!treeOpen)} title={treeOpen ? "Collapse" : "Expand"}>
            {treeOpen ? "‹" : "›"}
          </button>
        </div>
        {treeOpen && <WorldTree ctx={ctx} rogues={rogues} />}
      </aside>
      <div className="cmp-main">
        <div className="card comparebar">
          <span className="lbl">Compare</span>
          <WorldSelect worlds={st.worlds} value={ctx.from} onChange={ctx.setFrom} testid="from" />
          <span className="arrow">→</span>
          <WorldSelect worlds={st.worlds} value={ctx.to} onChange={ctx.setTo} testid="to" />
          <button className="btn sm" onClick={() => ctx.compare(ctx.to, ctx.from)} disabled={!ctx.to}>
            Swap
          </button>
          <div className="quick">
            {st.agents.slice(0, 8).map((a) =>
              ctx.heads[a.id] ? (
                <button key={a.id} className="btn sm" onClick={() => ctx.compare("base", ctx.heads[a.id])} data-testid={`quick-${a.id}`}>
                  <span className="swatch" style={{ background: AGENT_COLOR[a.id] }} />
                  base → {a.id}
                </button>
              ) : null,
            )}
          </div>
        </div>
        {!ctx.to || ctx.from === ctx.to ? (
          <div className="card empty">
            <h2>Pick two worlds</h2>
            <p>Choose checkpoints above, click a step in the tree, or a dot in the Overview graph.</p>
          </div>
        ) : (
          <>
            {ctx.stepPair && ctx.stepPair.kind === "checkpoint" && <StepTrace w={ctx.stepPair} onRollback={ctx.rollback} onFork={ctx.fork} disabled={st.running} />}
            <div className="diffwrap">
              <div className="card files">
                <div className="files-h">
                  <div className="mono">
                    {ctx.from} → {ctx.to}
                  </div>
                  {ctx.diff && <Totals d={ctx.diff} />}
                  {ctx.loadingDiff && <div className="faint">Diffing…</div>}
                  {ctx.diffErr && <div className="err">{ctx.diffErr}</div>}
                </div>
                {ctx.diff?.files.map((f) => (
                  <FileRow key={f.path} f={f} sel={f.path === ctx.sel} onClick={() => ctx.setSel(f.path)} />
                ))}
                {ctx.diff && ctx.diff.files.length === 0 && <div className="empty">No differences.</div>}
              </div>
              <div className="card detail">
                {ctx.selected ? <FileDetailView key={`${ctx.from}|${ctx.to}|${ctx.selected.path}`} from={ctx.from} to={ctx.to} fc={ctx.selected} /> : <div className="empty">Select a file</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function WorldTree({ ctx, rogues }: { ctx: DashCtx; rogues: Record<string, Rogue> }) {
  const { st } = ctx;
  const owner = st.worlds.find((w) => w.id === ctx.to)?.agent ?? st.worlds.find((w) => w.id === st.worlds.find((x) => x.id === ctx.to)?.forkOf)?.agent;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => open[id] ?? id === owner;
  const badge = (id: string) => (
    <>
      {ctx.from === id && <span className="ft from">FROM</span>}
      {ctx.to === id && <span className="ft to">TO</span>}
    </>
  );
  return (
    <div className="tree-b">
      <div className="t-row t-base" onClick={() => ctx.setFrom("base")} title="Set as FROM">
        <span className="t-dot" style={{ background: "var(--text)" }} />
        <span className="t-name">base</span>
        {badge("base")}
      </div>
      {st.agents.map((a) => {
        const steps = st.worlds.filter((w) => w.agent === a.id && w.kind === "checkpoint").sort((p, q) => (p.step ?? 0) - (q.step ?? 0));
        const o = isOpen(a.id);
        return (
          <div key={a.id} className="t-agent">
            <div className="t-row t-head" onClick={() => setOpen({ ...open, [a.id]: !o })} data-testid={`tree-${a.id}`}>
              <span className={`t-chev ${o ? "open" : ""}`}>›</span>
              <span className="t-dot" style={{ background: AGENT_COLOR[a.id] }} />
              <span className="t-name">
                {a.id} <span className="muted">{a.name}</span>
              </span>
              <Chip r={rogues[a.id]} running={a.status === "running"} />
              <span className="t-count">{steps.length}</span>
            </div>
            {o && (
              <div className="t-steps">
                {steps.map((w) => {
                  const undone = a.rolledBackTo !== undefined && (w.step ?? 0) > a.rolledBackTo;
                  const bad = rogues[a.id]?.firstBad === w.step;
                  return (
                    <div key={w.id}>
                      <div
                        className={`t-row t-step ${ctx.to === w.id ? "sel" : ""} ${undone ? "undone" : ""} ${bad ? "bad" : ""}`}
                        onClick={() => ctx.compare(w.parent ?? "base", w.id)}
                        data-testid={`node-${w.id}`}
                        title={`${w.stepName}${w.ref ? `\nArchil checkpoint ${w.ref}` : ""}`}
                      >
                        <span className="t-num">{w.step}</span>
                        <span className="t-name">{w.stepName}</span>
                        {badge(w.id)}
                        {a.rolledBackTo === w.step && <span className="ft head">HEAD</span>}
                        <span className="t-hover">
                          <span className="t-ms">{ms(w.snapshotMs)}</span>
                          <button className="icon-btn" title={`Roll ${a.id} back to here`} onClick={(e) => { e.stopPropagation(); ctx.rollback(w.id); }} disabled={st.running} data-testid={`rollback-${w.id}`}>
                            ↺
                          </button>
                          <button className="icon-btn" title="Fork from here" onClick={(e) => { e.stopPropagation(); ctx.fork(w.id); }} disabled={st.running} data-testid={`fork-${w.id}`}>
                            ⑂
                          </button>
                        </span>
                      </div>
                      {st.worlds
                        .filter((f) => f.forkOf === w.id)
                        .map((f) => (
                          <div key={f.id} className={`t-row t-step t-fork ${ctx.to === f.id ? "sel" : ""}`} onClick={() => ctx.compare("base", f.id)} data-testid={`node-${f.id}`}>
                            <span className="t-num">⑂</span>
                            <span className="t-name">{f.label}</span>
                            {badge(f.id)}
                          </div>
                        ))}
                    </div>
                  );
                })}
                {a.status === "running" && (
                  <div className="t-row t-step">
                    <span className="t-num">{a.stepsDone + 1}</span>
                    <span className="t-name muted">{a.currentStep ?? "working…"}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Bisect / History / Swarm */

function BisectPage({ ctx, onCompare }: { ctx: DashCtx; onCompare: (f: string, t: string) => void }) {
  const { st } = ctx;
  const agents = st.agents.filter((a) => ctx.heads[a.id]);
  if (!agents.length) return <div className="card empty">Run the agents first.</div>;
  return (
    <div className="page-narrow">
      <BisectModal
        inline
        agents={agents}
        presets={st.presets}
        worlds={st.worlds}
        live={ctx.bisectLive}
        onClose={() => undefined}
        onShow={onCompare}
        onRollback={(w) => ctx.rollback(w)}
        onRun={async (agent, invariant) => {
          ctx.setBisectLive({ agent, invariant, checks: [], verdict: "error", bisectChecks: 0, totalSteps: 0, phase: "start" });
          const r = await api<BisectResult>("/api/bisect", { method: "POST", body: JSON.stringify({ agent, invariant }) });
          ctx.setBisectLive({ ...r, phase: "done" });
          ctx.loadState();
        }}
      />
    </div>
  );
}

function HistoryPage({ ctx, onCompare }: { ctx: DashCtx; onCompare: (f: string, t: string) => void }) {
  const agents = ctx.st.agents.filter((a) => ctx.heads[a.id]);
  if (!agents.length) return <div className="card empty">Run the agents first.</div>;
  return (
    <div className="page-narrow">
      <HistorySearch agents={agents} onCompare={onCompare} web={ctx.st.keenable?.mode !== "off"} />
    </div>
  );
}

function SwarmPage({
  ctx, rogues, onCompare, go, onDetails,
}: { ctx: DashCtx; rogues: Record<string, Rogue>; onCompare: (f: string, t: string) => void; go: (p: Page) => void; onDetails?: (agent: string, broken: boolean) => void }) {
  const { st } = ctx;
  const [card, setCard] = useState<string | null>(null);
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCard(null);
    const onDoc = (e: MouseEvent) => !(e.target as HTMLElement).closest?.(".tile-wrap") && setCard(null);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [card]);
  const sentenceFor = (agentId: string): string => {
    const r = rogues[agentId];
    const sum = ctx.summaries.find((x) => x.agent === agentId);
    if (!sum) return "";
    const files = sum.diff.files;
    const lost = Math.max(0, ...files.filter((f) => f.kind === "csv").map((f) => f.stats.rowsLost ?? 0));
    const shifts = Math.max(0, ...files.map((f) => f.stats.magnitudeShifts ?? 0));
    const csv = files.filter((f) => f.kind === "csv" && f.status === "modified").sort((a, b) => (b.stats.cellsChanged ?? 0) - (a.stats.cellsChanged ?? 0))[0];
    const merged = Math.max(0, (csv?.stats.rowsRemoved ?? 0) - lost);
    const at = r?.firstBad !== undefined ? ` at step ${r.firstBad}` : "";
    if (st.scenario === "geargo") {
      if (r && !r.ok) return `Broke “${r.failed.join("”, “")}”${at}${r.stepName ? ` (${r.stepName})` : ""}.`;
      const cells = files.filter((f) => f.kind === "csv").reduce((n, f) => n + (f.stats.cellsChanged ?? 0), 0);
      return cells ? `Changed ${cells.toLocaleString("en-US")} product cells, no rule broken.` : `Wrote ${files.length} files, no rule broken.`;
    }
    if (lost > 0) return `Deleted ${lost.toLocaleString("en-US")} customers${at}${shifts ? ` and divided ${shifts.toLocaleString("en-US")} deal amounts by 100` : ""}.`;
    if (shifts > 0) return `Divided ${shifts.toLocaleString("en-US")} deal amounts by 100${at}.`;
    if (merged > 0) return `Merged ${merged.toLocaleString("en-US")} duplicates, nothing lost.`;
    if ((csv?.stats.columnsAdded ?? 0) > 0) return `Added ${csv!.stats.columnsAdded} columns and filled ${(csv!.stats.cellsFilled ?? 0).toLocaleString("en-US")} cells, nothing lost.`;
    return `Changed ${(csv?.stats.cellsChanged ?? 0).toLocaleString("en-US")} cells, nothing lost.`;
  };
  const counts = useMemo(() => {
    const v = Object.values(rogues);
    return { clean: v.filter((r) => r.ok).length, bad: v.filter((r) => !r.ok).length };
  }, [rogues]);
  return (
    <div className="ov">
      <div className="ov-h">
        <h1>Swarm</h1>
        <span className="muted">
          {st.agents.length} agents · <b className="okc">{counts.clean} clean</b> · <b className={counts.bad ? "badc" : "faint"}>{counts.bad} broke rules</b>
        </span>
        {st.agents.length <= 3 && st.scenario !== "geargo" && (
          <span className="faint">
            Pick <b>Swarm × 8</b> in the top bar and run to fan out more agents.
          </span>
        )}
      </div>
      <div className="tiles" data-testid="tiles">
        {st.agents.map((a) => {
          const r = rogues[a.id];
          return (
            <div key={a.id} className="tile-wrap">
              <button
                className={`tile ${a.status === "running" ? "run" : r ? (r.ok ? "ok" : "bad") : ""} ${card === a.id ? "open" : ""}`}
                onClick={() => setCard(card === a.id ? null : a.id)}
                aria-expanded={card === a.id}
                data-testid={`tile-${a.id}`}
              >
                <AgentAvatar name={a.name} status={r && a.status !== "running" ? (r.ok ? "ok" : "bad") : undefined} size={28} />
                <span className="tile-id">{a.id}</span>
                <span className="tile-name">{a.name}</span>
                <span className="tile-st">{a.status === "running" ? `step ${a.stepsDone + 1}/${a.stepsTotal}` : r ? (r.ok ? "clean" : r.firstBad !== undefined ? `broke at step ${r.firstBad}` : r.failed[0]) : "…"}</span>
              </button>
              {card === a.id && (
                <div className="agent-card" role="dialog" aria-label={a.name} data-testid={`agentcard-${a.id}`}>
                  <AgentAvatar name={a.name} status={r ? (r.ok ? "ok" : "bad") : undefined} size={56} />
                  <div className="agent-card-b">
                    <div className="agent-card-t">
                      <b>{a.name}</b>
                      {r && (r.ok ? <span className="chip ok">✓ clean</span> : <span className="chip bad">✗ broke{r.firstBad !== undefined ? ` @${r.firstBad}` : ""}</span>)}
                    </div>
                    <p>{sentenceFor(a.id)}</p>
                    <button
                      className="btn sm primary"
                      onClick={() => {
                        setCard(null);
                        if (onDetails) onDetails(a.id, !!r && !r.ok);
                        else if (ctx.heads[a.id]) onCompare("base", ctx.heads[a.id]);
                      }}
                      data-testid={`details-${a.id}`}
                    >
                      Details →
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!st.running && ctx.anyCheckpoint && <Review key={`${st.worlds.length}|${st.agents.map((a) => `${a.id}:${a.status}`).join()}`} onBisect={() => go("bisect")} onCompare={onCompare} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Classic dashboard: icon rail + pages */

export type ClassicPage = "dashboard" | "network" | "bisect" | "history" | "swarm";
const CLASSIC_PAGES: ClassicPage[] = ["dashboard", "network", "bisect", "history", "swarm"];
const CLASSIC_LABELS: Record<ClassicPage, string> = { dashboard: "Dashboard", network: "Network", bisect: "Bisect", history: "History", swarm: "Swarm" };
const CLASSIC_ICONS: Record<ClassicPage, ReactNode> = {
  dashboard: <path d="M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z" />,
  network: <path d="M5 4a1.6 1.6 0 1 0 0 .01M5 6v8M5 10c0-3 4-3 6-3h2M5 14c0 2 3 2 5 2h3M15 7a1.6 1.6 0 1 0 0 .01M15 16a1.6 1.6 0 1 0 0 .01" />,
  bisect: <path d="M9 3a6 6 0 1 0 0 12A6 6 0 0 0 9 3zM13.5 13.5 18 18M9 6v6M6 9h6" />,
  history: <path d="M10 3a7 7 0 1 1-6.6 4.7M3 3v4h4M10 6v4l3 2" />,
  swarm: <path d="M4 4h3v3H4zM8.5 4h3v3h-3zM13 4h3v3h-3zM4 8.5h3v3H4zM8.5 8.5h3v3h-3zM13 8.5h3v3h-3zM4 13h3v3H4zM8.5 13h3v3h-3zM13 13h3v3h-3z" />,
};

export function pageFromHash(): ClassicPage {
  const h = location.hash.slice(1) as ClassicPage;
  return CLASSIC_PAGES.includes(h) ? h : "dashboard";
}

export function Rail({ page, onPage }: { page: ClassicPage; onPage: (p: ClassicPage) => void }) {
  const [hover, setHover] = useState<{ p: ClassicPage; top: number } | null>(null);
  return (
    <nav className="rail" aria-label="Pages" onMouseLeave={() => setHover(null)}>
      {hover && (
        <div className="rail-pop" style={{ top: hover.top }} role="tooltip" data-testid={`railpop-${hover.p}`}>
          <PageArt page={hover.p} size={48} />
          <div>
            <b>{CLASSIC_LABELS[hover.p]}</b>
            <span>{PAGE_LINES[hover.p]}</span>
          </div>
        </div>
      )}
      <a className="rail-logo rail-home" href="/" data-tip="Home" aria-label="Home" data-testid="home-link">
        <LogoMark size={30} />
      </a>
      {CLASSIC_PAGES.map((p) => (
        <button
          key={p}
          className={`rail-btn ${page === p ? "on" : ""}`}
          onClick={() => {
            onPage(p);
            setHover(null);
          }}
          onMouseEnter={(e) => setHover({ p, top: (e.currentTarget as HTMLElement).offsetTop - 6 })}
          onFocus={(e) => setHover({ p, top: (e.currentTarget as HTMLElement).offsetTop - 6 })}
          onBlur={() => setHover(null)}
          aria-label={CLASSIC_LABELS[p]}
          data-testid={`nav-${p}`}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {CLASSIC_ICONS[p]}
          </svg>
        </button>
      ))}
    </nav>
  );
}

/** The non-dashboard pages, rendered inside the classic layout's main column. */
export function PageHost({
  ctx, page, onCompare, onPage, onDetails,
}: { ctx: DashCtx; page: ClassicPage; onCompare: (f: string, t: string) => void; onPage: (p: ClassicPage) => void; onDetails?: (agent: string, broken: boolean) => void }) {
  const rogues = useRogues(ctx.st);
  const go = (p: Page) => onPage(p === "bisect" ? "bisect" : p === "history" ? "history" : p === "swarm" ? "swarm" : "dashboard");
  if (page === "network") {
    const { st } = ctx;
    return (
      <div className="ov">
        <PageIntro page="network" />
        <NetworkView ctx={ctx} rogues={rogues} onOpenDiff={onCompare} onBisect={() => onPage("bisect")} />
        {st.running && <div className="faint">Agents are running; the graph refreshes when they finish.</div>}
      </div>
    );
  }
  if (page === "bisect") return (<div className="ov"><PageIntro page="bisect" /><BisectPage ctx={ctx} onCompare={onCompare} /></div>);
  if (page === "history") return (<div className="ov"><PageIntro page="history" /><HistoryPage ctx={ctx} onCompare={onCompare} /></div>);
  if (page === "swarm") return (<div className="ov"><PageIntro page="swarm" /><SwarmPage ctx={ctx} rogues={rogues} onCompare={onCompare} go={go} onDetails={onDetails} /></div>);
  return null;
}

/* ------------------------------------------------------------------ Page intros (plain-English headers) */

const INTROS: Record<ClassicPage, { title: string; q: string; how: string[] }> = {
  dashboard: {
    title: "Dashboard",
    q: "What did each agent do to your data?",
    how: [
      "Cards show each agent's result. Red means it broke a rule.",
      "The list on the left is every saved step (an Archil checkpoint).",
      "Pick two versions in Compare to see exactly what changed, row by row.",
    ],
  },
  network: {
    title: "Network",
    q: "How did each agent get here, step by step?",
    how: [
      "Each lane is an agent, branching off the original data on the left.",
      "Each dot is a saved Archil checkpoint. Bigger dots changed more.",
      "A red ring is the first step that broke a rule. ↺ marks a roll back.",
    ],
  },
  bisect: {
    title: "Bisect",
    q: "Which step broke it?",
    how: [
      "Write a rule the data must satisfy, e.g. rows(customers.csv) >= 4913.",
      "Bisect checks saved steps in halves instead of one by one.",
      "It names the first bad step in a few checks, like git bisect for data.",
    ],
  },
  history: {
    title: "History",
    q: "When did this value change, and who changed it?",
    how: [
      "Search a customer, an id, an email, any value, or a SQL query.",
      "See every step where it existed, changed or vanished.",
      "If a web-searching agent wrote a value, its source URL is shown.",
    ],
  },
  swarm: {
    title: "Swarm",
    q: "Which of many agents went rogue?",
    how: [
      "One tile per agent, all forked from the same data.",
      "Green passed every rule. Red broke at least one.",
      "Click a tile to inspect what that agent changed.",
    ],
  },
};

export function PageIntro({ page }: { page: ClassicPage }) {
  const it = INTROS[page];
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(`intro-${page}`);
      return page === "dashboard" ? v === "open" : v !== "closed";
    } catch {
      return page !== "dashboard";
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(`intro-${page}`, next ? "open" : "closed");
    } catch {
      /* ignore */
    }
  };
  return (
    <header className="intro" data-testid={`intro-${page}`}>
      <div className="intro-top">
        {page !== "dashboard" && <PageArt page={page} size={64} />}
        <h1>{it.title}</h1>
        <p className="intro-q">{it.q}</p>
        <button className="intro-toggle" onClick={toggle} aria-expanded={open}>
          {open ? "Hide guide" : "How to read this"}
        </button>
      </div>
      {open && (
        <ol className="intro-how">
          {it.how.map((h, i) => (
            <li key={i}>
              <span className="intro-n">{i + 1}</span>
              {h}
            </li>
          ))}
        </ol>
      )}
    </header>
  );
}
