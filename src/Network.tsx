// Network page: a git-network-style graph of every agent's checkpoints, with change-sized dots,
// first-bad rings, rollback/fork lanes, per-lane sparklines, hover cards and a detail panel.
import { useEffect, useMemo, useState } from "react";
import type { WorldMeta } from "./types.ts";
import { AGENT_COLOR, StatsStrip, ms } from "./App.tsx";
import type { DashCtx, Rogue } from "./Dashboard.tsx";
import { api, fmt } from "./util.ts";

interface StepRow {
  world: string;
  step: number;
  stepName?: string;
  ref?: string;
  snapshotMs: number;
  stepMs?: number;
  files: number;
  rowsAdded: number;
  rowsRemoved: number;
  rowsChanged: number;
  cellsChanged: number;
  columnsAdded: number;
  kind: "delete" | "modify" | "add" | "schema" | "none";
  warn: number;
  customers: number | null;
  dealTotal: number | null;
  invariants: { label: string; ok: boolean }[];
}
interface NetData {
  base: { customers: number | null; dealTotal: number | null };
  agents: { id: string; steps: StepRow[] }[];
  backend: string;
  labels?: { rows: string; value: string };
}

const GLYPH: Record<StepRow["kind"], string> = { delete: "−", modify: "~", add: "+", schema: "▦", none: "" };
const KIND_LABEL: Record<StepRow["kind"], string> = { delete: "rows deleted", modify: "values modified", add: "rows/files added", schema: "schema change", none: "no data change" };

function magnitude(s: StepRow) {
  return s.rowsAdded + s.rowsRemoved + s.rowsChanged + s.cellsChanged / 4 + s.columnsAdded * 200;
}

export function NetworkView({ ctx, rogues, onOpenDiff, onBisect }: { ctx: DashCtx; rogues: Record<string, Rogue>; onOpenDiff: (f: string, t: string) => void; onBisect: () => void }) {
  const { st } = ctx;
  const [data, setData] = useState<NetData | null>(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState<{ x: number; y: number; s: StepRow; agent: string } | null>(null);
  const [sel, setSel] = useState<{ s: StepRow; agent: string } | null>(null);
  const key = `${st.worlds.length}|${st.agents.map((a) => `${a.id}:${a.status}`).join()}`;
  useEffect(() => {
    if (st.running) return;
    api<NetData & { busy?: boolean }>("/api/network")
      .then((d) => !d.busy && setData(d))
      .catch((e) => setErr(String(e.message)));
  }, [key, st.running]);

  const byAgent = useMemo(() => new Map((data?.agents ?? []).map((a) => [a.id, a.steps])), [data]);
  const forks = st.worlds.filter((w) => w.kind === "fork");
  const lanes: { key: string; agentId?: string; fork?: WorldMeta }[] = [...st.agents.map((a) => ({ key: a.id, agentId: a.id })), ...forks.map((f) => ({ key: f.id, fork: f }))];
  const n = lanes.length;
  const compact = n > 8;
  const tiny = n > 20;
  const laneH = tiny ? 18 : compact ? 28 : 54;
  const maxSteps = Math.max(1, ...st.agents.map((a) => Math.max(a.stepsTotal, a.stepsDone)));
  const allMag = (data?.agents ?? []).flatMap((a) => a.steps.map(magnitude));
  const maxMag = Math.max(1, ...allMag);
  const rOf = (s: StepRow) => {
    const lo = tiny ? 3 : compact ? 4 : 5;
    const hi = tiny ? 6 : compact ? 8 : 12;
    return lo + (hi - lo) * (Math.log1p(magnitude(s)) / Math.log1p(maxMag));
  };

  // geometry (viewBox units)
  const labelW = 230;
  const sparkW = compact ? 120 : 170;
  const W = 1300;
  const x0 = labelW + 26;
  const gridRight = W - sparkW - 100;
  const dx = (gridRight - x0) / maxSteps;
  const top = 34;
  const H = top + n * laneH + 26;
  const xOf = (s: number) => x0 + s * dx;
  const yOf = (i: number) => top + i * laneH + laneH / 2;
  const baseY = top - 14;

  // sparkline scales (shared across lanes so drops are comparable)
  const custVals = [data?.base.customers ?? 0, ...(data?.agents ?? []).flatMap((a) => a.steps.map((s) => s.customers ?? 0))].filter((v) => v > 0);
  const lb = data?.labels ?? { rows: "customers.csv", value: "deal value" };
  const dealVals = [data?.base.dealTotal ?? 0, ...(data?.agents ?? []).flatMap((a) => a.steps.map((s) => s.dealTotal ?? 0))].filter((v) => v > 0);
  const cMin = Math.min(...custVals);
  const cMax = Math.max(...custVals);
  const dMin = Math.min(...dealVals);
  const dMax = Math.max(...dealVals);

  const totals = useMemo(() => {
    const steps = (data?.agents ?? []).flatMap((a) => a.steps);
    return {
      checkpoints: st.worlds.filter((w) => w.kind === "checkpoint").length,
      branches: forks.length + st.agents.filter((a) => a.rolledBackTo !== undefined).length,
      firstBad: Object.values(rogues).filter((r) => r.firstBad !== undefined).length,
      rows: steps.reduce((t, s) => t + s.rowsAdded + s.rowsRemoved + s.rowsChanged, 0),
    };
  }, [data, st.worlds, st.agents, rogues, forks.length]);

  if (!ctx.anyCheckpoint && !st.running) return <div className="card empty">Run the agents first.</div>;

  const pick = (agent: string, s: StepRow) => setSel({ agent, s });

  return (
    <div className="net">
      <div className="net-stats" data-testid="net-stats">
        <div><b>{st.agents.length}</b><span>agents</span></div>
        <div><b>{totals.checkpoints}</b><span>checkpoints</span></div>
        <div><b>{totals.branches}</b><span>branches / rollbacks</span></div>
        <div className={totals.firstBad ? "bad" : ""}><b>{totals.firstBad}</b><span>first-bad steps found</span></div>
        <div><b>{fmt(totals.rows)}</b><span>rows changed</span></div>
        <div className="net-be"><span>{data?.backend ?? st.backend.label}</span></div>
      </div>
      {st.backend.kind === "archil" && st.backend.stats && <StatsStrip s={st.backend.stats} disk={st.diskMode} keenable={st.keenable} />}
      <div className={`net-body ${sel ? "with-panel" : ""}`}>
        <section className="card net-card">
          <div className="net-legend">
            <span><i className="lg lg-mod">~</i> modify</span>
            <span><i className="lg lg-del">−</i> delete</span>
            <span><i className="lg lg-add">+</i> add</span>
            <span><i className="lg lg-sch">▦</i> schema</span>
            <span><i className="lg lg-bad" /> first bad step</span>
            <span><i className="lg lg-und" /> rolled back</span>
            <span><i className="lg lg-fork" /> fork (branch)</span>
            <span className="faint">dot size = rows/cells changed (log)</span>
            <span className="spark-key"><i className="sk sk-c" /> {lb.rows} rows <i className="sk sk-d" /> {lb.value}</span>
          </div>
          {err && <div className="err" style={{ padding: 12 }}>{err}</div>}
          <div className="net-wrap">
            <svg viewBox={`0 0 ${W} ${H}`} className="net-svg" data-testid="graph" role="img" aria-label="Agent checkpoint network">
              {Array.from({ length: maxSteps + 1 }, (_, s) => (
                <g key={s}>
                  <line x1={xOf(s)} x2={xOf(s)} y1={top - 6} y2={H - 20} className="n-grid" />
                  <text x={xOf(s)} y={H - 6} textAnchor="middle" className="n-tick">{s === 0 ? "base" : s}</text>
                </g>
              ))}
              <text x={gridRight + 36 + sparkW / 2} y={H - 6} textAnchor="middle" className="n-tick">{lb.rows} rows / {lb.value}</text>
              <circle cx={xOf(0)} cy={baseY} r={7} className="n-base" />
              <text x={xOf(0) + 12} y={baseY + 4} className="n-basel">base</text>
              {lanes.map((lane, i) => {
                const y = yOf(i);
                if (lane.fork) {
                  const f = lane.fork;
                  const src = st.worlds.find((w) => w.id === f.forkOf);
                  const si = lanes.findIndex((l) => l.agentId === src?.agent);
                  const sx = xOf(src?.step ?? 0);
                  const sy = si >= 0 ? yOf(si) : baseY;
                  return (
                    <g key={f.id}>
                      <path d={`M${sx},${sy} C${sx + 18},${sy} ${sx},${y} ${sx + 28},${y}`} className="n-forkline" />
                      <line x1={sx + 28} y1={y} x2={sx + dx * 0.9} y2={y} className="n-forkline" />
                      <rect x={sx + dx * 0.9 - 6} y={y - 6} width={12} height={12} rx={3} className="n-forkdot" onClick={() => onOpenDiff("base", f.id)}>
                        <title>{`${f.id} · ${f.branchRef ? `Archil branch ${f.branchRef}` : "APFS clone"}`}</title>
                      </rect>
                      <text x={14} y={y + 4} className="n-name faint">⑂ fork of {f.forkOf}</text>
                    </g>
                  );
                }
                const a = st.agents.find((x) => x.id === lane.agentId)!;
                const color = AGENT_COLOR[a.id];
                const steps = byAgent.get(a.id) ?? [];
                const metaSteps = st.worlds.filter((w) => w.agent === a.id && w.kind === "checkpoint");
                const last = Math.max(0, ...metaSteps.map((w) => w.step ?? 0));
                const rb = a.rolledBackTo;
                const bad = rogues[a.id]?.firstBad;
                const r = rogues[a.id];
                const chip = a.status === "running" ? "running" : r ? (r.ok ? "clean" : bad !== undefined ? `broke @${bad}` : "broke") : "";
                // sparkline
                const sx0 = gridRight + 36;
                const series = [data?.base.customers ?? null, ...steps.map((s) => s.customers)];
                const dseries = [data?.base.dealTotal ?? null, ...steps.map((s) => s.dealTotal)];
                const sh = Math.max(10, laneH - 12);
                const px = (k: number) => sx0 + (k / Math.max(1, maxSteps)) * sparkW;
                const py = (v: number, lo: number, hi: number) => y + sh / 2 - ((v - lo) / Math.max(1, hi - lo)) * sh;
                const path = (vals: (number | null)[], lo: number, hi: number) =>
                  vals.map((v, k) => (v === null ? "" : `${k === 0 ? "M" : "L"}${px(k).toFixed(1)},${py(v, lo, hi).toFixed(1)}`)).join(" ");
                const dropIdx = series.findIndex((v, k) => k > 0 && v !== null && series[k - 1] !== null && v < (series[k - 1] as number) * 0.97);
                return (
                  <g key={a.id} className="n-lane">
                    <rect x={0} y={y - laneH / 2} width={W} height={laneH} className={`n-band ${i % 2 ? "odd" : ""}`} />
                    {(() => {
                      // forks branch off their source checkpoint's dot; everyone else off base
                      const srcW = a.forkOf ? st.worlds.find((w) => w.id === a.forkOf) : undefined;
                      const si = srcW ? lanes.findIndex((l) => l.agentId === srcW.agent) : -1;
                      const s0 = srcW?.step ?? 0;
                      const sx = xOf(s0);
                      const sy = si >= 0 ? yOf(si) : baseY + 7;
                      const bend = sx + Math.min(dx * 0.6, 36);
                      return (
                        <>
                          <path d={`M${sx},${sy} C${sx + (srcW ? 14 : 0)},${y} ${sx},${y} ${bend},${y}`} stroke={color} strokeWidth={2.2} fill="none" strokeDasharray={srcW ? "5 3" : undefined} />
                          {last > s0 && <line x1={bend} y1={y} x2={xOf(rb ?? last)} y2={y} stroke={color} strokeWidth={2.2} />}
                        </>
                      );
                    })()}
                    {rb !== undefined && rb < last && <line x1={xOf(rb)} y1={y} x2={xOf(last)} y2={y} stroke={color} strokeWidth={1.6} strokeDasharray="3 4" opacity={0.45} />}
                    <circle cx={14} cy={y} r={4.5} fill={color} />
                    <text x={26} y={y + 4} className={`n-name ${compact ? "sm" : ""}`}>
                      {(() => {
                        const label = a.forkOf ? `⑂ ${a.name} @${a.forkOf.split("@")[1]}` : a.live?.status === "live" || a.live?.status === "running" ? `${a.id} · LIVE · Mistral` : `${a.id} · ${a.name}`;
                        const max = compact ? 16 : 19;
                        return label.length > max ? label.slice(0, max - 1) + "…" : label;
                      })()}
                    </text>
                    {!tiny && chip && (
                      <g>
                        <rect x={labelW - 74} y={y - 9} width={70} height={18} rx={9} className={`n-chip ${r?.ok ? "ok" : chip.startsWith("broke") ? "bad" : "run"}`} />
                        <text x={labelW - 39} y={y + 4} textAnchor="middle" className={`n-chipt ${r?.ok ? "ok" : chip.startsWith("broke") ? "bad" : "run"}`}>{chip}</text>
                      </g>
                    )}
                    {steps.map((s) => {
                      const cx = xOf(s.step);
                      const rad = rOf(s);
                      const isBad = bad === s.step;
                      const undone = rb !== undefined && s.step > rb;
                      const selected = sel?.s.world === s.world;
                      return (
                        <g
                          key={s.world}
                          className="n-dot"
                          tabIndex={0}
                          role="button"
                          aria-label={`${s.world}: ${s.stepName}`}
                          data-testid={`gdot-${s.world}`}
                          onClick={() => pick(a.id, s)}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick(a.id, s)}
                          onMouseEnter={() => setHover({ x: cx, y, s, agent: a.id })}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover({ x: cx, y, s, agent: a.id })}
                          onBlur={() => setHover(null)}
                        >
                          {isBad && <circle cx={cx} cy={y} r={rad + 7} className="n-halo" />}
                          <circle
                            cx={cx}
                            cy={y}
                            r={rad}
                            fill={isBad ? "#fff" : undone ? "#fff" : color}
                            stroke={isBad ? "#D7263D" : color}
                            strokeWidth={isBad ? 3.2 : selected ? 3 : 1.5}
                            opacity={undone ? 0.5 : 1}
                            className={`${isBad ? "bad" : ""} ${selected ? "sel" : ""}`}
                          />
                          {!compact && rad >= 7 && GLYPH[s.kind] && (
                            <text x={cx} y={y + 4} textAnchor="middle" className={`n-glyph ${isBad || undone ? "dark" : ""}`}>{GLYPH[s.kind]}</text>
                          )}
                        </g>
                      );
                    })}
                    {bad !== undefined && !tiny && <text x={xOf(bad)} y={y - (compact ? 10 : 18)} textAnchor="middle" className="n-badt">first bad</text>}
                    {rb !== undefined && <text x={xOf(rb)} y={y + (compact ? 14 : 24)} textAnchor="middle" className="n-head">↺ HEAD</text>}
                    {a.status === "running" && <circle cx={xOf(a.stepsDone + 1)} cy={y} r={5} className="n-run" stroke={color} />}
                    {/* sparkline */}
                    {custVals.length > 0 && (
                      <g data-testid={`spark-${a.id}`}>
                        <path d={path(dseries, dMin, dMax)} className="n-spark-d" />
                        <path d={path(series, cMin, cMax)} className="n-spark-c" stroke={color} />
                        {dropIdx > 0 && <circle cx={px(dropIdx)} cy={py(series[dropIdx] as number, cMin, cMax)} r={3.2} className="n-spark-drop" />}
                        {!compact && series[series.length - 1] !== null && (
                          <text x={sx0 + sparkW + 6} y={y + 4} className="n-spark-v">{fmt(series[series.length - 1] as number)}</text>
                        )}
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
            {hover && <HoverCard h={hover} W={W} H={H} backend={data?.backend ?? st.backend.label} />}
          </div>
        </section>
        {sel && (
          <DetailPanel
            sel={sel}
            prev={byAgent.get(sel.agent)?.find((x) => x.step === sel.s.step - 1)}
            base={data?.base}
            labels={data?.labels}
            ctx={ctx}
            onClose={() => setSel(null)}
            onOpenDiff={onOpenDiff}
            onBisect={onBisect}
          />
        )}
      </div>
    </div>
  );
}

function HoverCard({ h, W, H, backend }: { h: { x: number; y: number; s: StepRow; agent: string }; W: number; H: number; backend: string }) {
  const s = h.s;
  const failed = s.invariants.filter((i) => !i.ok);
  return (
    <div className="n-hover" style={{ left: `${(h.x / W) * 100}%`, top: `${(h.y / H) * 100}%` }}>
      <div className="n-hover-t">
        {s.world} · {s.stepName}
      </div>
      <div className="n-hover-g">
        <span>files</span><b>{s.files}</b>
        <span>rows</span><b>{s.rowsAdded ? `+${fmt(s.rowsAdded)} ` : ""}{s.rowsRemoved ? `−${fmt(s.rowsRemoved)} ` : ""}{s.rowsChanged ? `~${fmt(s.rowsChanged)}` : ""}{!s.rowsAdded && !s.rowsRemoved && !s.rowsChanged ? "0" : ""}</b>
        <span>cells</span><b>{fmt(s.cellsChanged)}</b>
        <span>rules</span><b className={failed.length ? "bad" : "ok"}>{failed.length ? `${failed.length} failing` : `all ${s.invariants.length} pass`}</b>
        <span>checkpoint</span><b>{ms(s.snapshotMs)} · {backend}</b>
      </div>
      {s.ref && <div className="n-hover-ref">{s.ref}</div>}
    </div>
  );
}

function DetailPanel({
  sel, prev, base, labels, ctx, onClose, onOpenDiff, onBisect,
}: {
  labels?: NetData["labels"];
  sel: { s: StepRow; agent: string };
  prev?: StepRow;
  base?: NetData["base"];
  ctx: DashCtx;
  onClose: () => void;
  onOpenDiff: (f: string, t: string) => void;
  onBisect: () => void;
}) {
  const s = sel.s;
  const before = prev ?? (base ? { customers: base.customers, dealTotal: base.dealTotal } : undefined);
  const parent = s.step > 1 ? `${sel.agent}@${s.step - 1}` : "base";
  return (
    <aside className="card n-panel" data-testid="net-panel">
      <div className="n-panel-h">
        <span className="swatch" style={{ background: AGENT_COLOR[sel.agent] }} />
        <b>{s.world}</b>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={onClose} aria-label="Close panel">✕</button>
      </div>
      <div className="n-panel-b">
        <div className="n-step">{s.stepName}</div>
        <div className="n-kind">{KIND_LABEL[s.kind]}</div>
        <dl className="n-dl">
          <dt>files changed</dt><dd>{s.files}</dd>
          <dt>rows</dt><dd>+{fmt(s.rowsAdded)} / −{fmt(s.rowsRemoved)} / ~{fmt(s.rowsChanged)}</dd>
          <dt>cells changed</dt><dd>{fmt(s.cellsChanged)}</dd>
          {s.customers !== null && (
            <>
              <dt>{labels?.rows ?? "customers.csv"}</dt>
              <dd className={before?.customers && s.customers < before.customers ? "bad" : ""}>{before?.customers !== undefined && before?.customers !== null ? `${fmt(before.customers)} → ` : ""}{fmt(s.customers)}</dd>
            </>
          )}
          {s.dealTotal !== null && (
            <>
              <dt>{labels?.value ?? "deal value"}</dt>
              <dd className={before?.dealTotal && s.dealTotal < before.dealTotal * 0.99 ? "bad" : ""}>{labels?.rows === "products.csv" ? `${fmt(s.dealTotal)} UZS` : `$${fmt(s.dealTotal)}`}</dd>
            </>
          )}
          <dt>checkpoint</dt><dd className="mono">{s.ref ?? "local clone"} · {ms(s.snapshotMs)}</dd>
        </dl>
        <div className="n-rules">
          {s.invariants.map((i) => (
            <div key={i.label} className={i.ok ? "ok" : "bad"}>
              <span>{i.ok ? "✓" : "✗"}</span> {i.label}
            </div>
          ))}
        </div>
        <div className="n-actions">
          <button className="btn primary sm" onClick={() => onOpenDiff(parent, s.world)} data-testid="net-open-diff">Open diff</button>
          <button className="btn sm" onClick={() => ctx.rollback(s.world)} disabled={ctx.st.running} data-testid="net-rollback">Roll back here</button>
          <button className="btn sm" onClick={() => ctx.fork(s.world)} disabled={ctx.st.running}>Fork here</button>
          <button className="btn sm" onClick={onBisect}>Bisect from here</button>
        </div>
      </div>
    </aside>
  );
}
