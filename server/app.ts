// Delta application state: the world tree, agent runs, diffs and bisect.
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StepContext, type ToolCall } from "./agents/context.ts";
import { LLM_MODEL, llmAvailable, runLlmAgent } from "./agents/llm.ts";
import { AGENTS, FORK_VARIANTS, activeSteps, forkVariantDef, swarmDefs, type AgentDef } from "./agents/scripted.ts";
import { keenableMode, keenableStats } from "./keenable.ts";
import { diffWorlds, type WorldDiffResult } from "./diff/engine.ts";
import type { FileDetail, Manifest, WorldDiff } from "./diff/types.ts";
import { evaluateInvariant } from "./invariant.ts";
import { seedFiles, type SeedInfo } from "./seed.ts";
import { ArchilStore } from "./store/archil.ts";
import { LocalStore } from "./store/local.ts";
import type { BackendInfo, StoreStats, WorldStore } from "./store/types.ts";
import { gitView } from "./diff/gitview.ts";
import { historySearch } from "./history.ts";
import { parseCsv } from "./diff/csv.ts";
import { sqliteScalar } from "./diff/sqlite.ts";
import { mkdirSync as mkdirS, writeFileSync as writeS, existsSync as existsS } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface WorldMeta {
  id: string;
  label: string;
  parent: string | null;
  kind: "base" | "checkpoint" | "fork";
  forkOf?: string;
  branchRef?: string; // Archil branch name for forks
  agent?: string;
  step?: number;
  stepName?: string;
  thought?: string;
  calls?: ToolCall[];
  createdAt: number;
  snapshotMs: number;
  stepMs?: number;
  ref?: string;
  frozen?: { ref?: string; manifest?: Manifest; dir?: string; branch?: string; diskId?: string };
}

export interface AgentState {
  id: string;
  name: string;
  role: string;
  status: "idle" | "running" | "done" | "error";
  mode: "scripted" | "llm";
  forkMs?: number;
  stepsDone: number;
  stepsTotal: number;
  error?: string;
  currentStep?: string;
  rolledBackTo?: number;
  rollback?: { ms: number; restoreMs: number; ref?: string; written: number; removed: number; at: number };
  forkOf?: string; // set on agents that continue from another agent's checkpoint
  forkRef?: string; // Archil branch created for the fork
  forkSource?: string; // display name of the agent it forked from
}

export interface Preset {
  id: string;
  label: string;
  expr: string;
}

export interface BisectCheck {
  world: string;
  step: number;
  ok: boolean;
  value: string;
  phase: "endpoint" | "bisect";
}

export interface BisectResult {
  agent: string;
  invariant: string;
  checks: BisectCheck[];
  verdict: "found" | "holds" | "broken-at-base" | "error";
  firstBad?: string;
  lastGood?: string;
  stepName?: string;
  error?: string;
  bisectChecks: number;
  totalSteps: number;
}

const stateFile = (kind: string) => resolve(`data/state-${kind}.json`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DeltaApp {
  store!: WorldStore;
  backendError?: string;
  worlds: WorldMeta[] = [];
  agents: AgentState[] = [];
  seedInfo?: SeedInfo;
  runId = "";
  running = false;
  lastBisect?: BisectResult;
  events = new EventEmitter();
  private diffCache = new Map<string, Promise<WorldDiffResult>>();
  paceMs = Number(process.env.DELTA_PACE_MS ?? 350);
  private defs: AgentDef[] = AGENTS;
  swarmSize = 0;
  diskMode?: unknown;

  async init(): Promise<void> {
    this.events.setMaxListeners(100);
    const wantArchil = !!process.env.ARCHIL_API_KEY && process.env.DELTA_BACKEND !== "local";
    if (wantArchil) {
      try {
        const s = new ArchilStore();
        await s.init();
        this.store = s;
      } catch (e) {
        this.backendError = `Archil unavailable (${String((e as Error).message).slice(0, 120)}); using local backend`;
        console.warn(this.backendError);
      }
    }
    if (!this.store) {
      this.store = new LocalStore();
      await this.store.init();
    }
    this.load();
  }

  backend(): BackendInfo & { error?: string; execCalls?: number; checkpoints?: number; stats?: StoreStats } {
    const s = this.store as unknown as { execCalls?: number; checkpoints?: number; stats?: () => StoreStats };
    return { ...this.store.info(), error: this.backendError, execCalls: s.execCalls, checkpoints: s.checkpoints, stats: s.stats?.() };
  }

  private emit(type: string, data: unknown) {
    this.events.emit("event", { type, data });
  }

  private persist() {
    mkdirSync("data", { recursive: true });
    for (const w of this.worlds) w.frozen = this.store.frozenMeta?.(w.id) ?? w.frozen;
    writeFileSync(
      stateFile(this.store.info().kind),
      JSON.stringify({ backend: this.store.info().kind, runId: this.runId, seedInfo: this.seedInfo, worlds: this.worlds, agents: this.agents, lastBisect: this.lastBisect }),
    );
  }

  private load() {
    const file = stateFile(this.store.info().kind);
    if (!existsSync(file)) return;
    if ((this.store as unknown as { freshWorkspace?: boolean }).freshWorkspace) {
      // Worlds saved for another Archil workspace can't be read with this key; keep them as a backup only.
      writeFileSync(file.replace(/\.json$/, `.old-${Date.now().toString(36)}.json`), readFileSync(file));
      writeFileSync(file, "{}");
      return;
    }
    try {
      const s = JSON.parse(readFileSync(file, "utf8"));
      if (s.backend !== this.store.info().kind) return;
      this.runId = s.runId;
      this.seedInfo = s.seedInfo;
      this.worlds = s.worlds ?? [];
      this.agents = (s.agents ?? []).map((a: AgentState) => (a.status === "running" ? { ...a, status: "error", error: "interrupted by restart" } : a));
      this.lastBisect = s.lastBisect;
      // Display names come from the current agent definitions, so renames apply to saved runs too.
      const swarmN = this.agents.filter((a) => a.id.startsWith("S")).length;
      const defs = swarmN ? swarmDefs(swarmN) : AGENTS;
      this.agents = this.agents.map((a) => {
        const d = defs.find((x) => x.id === a.id);
        return d ? { ...a, name: d.name, role: d.role } : a;
      });
      for (const w of this.worlds) if (w.frozen) this.store.restore?.(w.id, w.frozen);
    } catch (e) {
      console.warn("could not load state:", (e as Error).message);
    }
  }

  presets(): Preset[] {
    const info = this.seedInfo;
    if (!info) return [];
    return [
      { id: "customers", label: "Customers drop only by true duplicates", expr: `rows(customers.csv) >= ${info.uniquePeople}` },
      { id: "deals", label: "Total deal value preserved", expr: `sql(crm.sqlite, "select round(sum(amount)) from deals") >= ${Math.floor(info.dealTotal * 0.999)}` },
      { id: "orphans", label: "Every deal points at a customer", expr: `sql(crm.sqlite, "select count(*) from deals d left join customers c on c.id = d.customer_id where c.id is null") == 0` },
    ];
  }

  snapshot() {
    return {
      backend: this.backend(),
      llm: { available: llmAvailable(), model: LLM_MODEL },
      runId: this.runId,
      seeded: this.worlds.some((w) => w.id === "base"),
      seedInfo: this.seedInfo,
      worlds: this.worlds.map(({ frozen, ...w }) => w),
      agents: this.agents,
      running: this.running,
      presets: this.presets(),
      swarmSize: this.swarmSize,
      forkVariants: FORK_VARIANTS,
      diskMode: this.diskMode,
      keenable: { mode: keenableMode(), ...keenableStats },
      lastBisect: this.lastBisect,
    };
  }

  async seed(): Promise<void> {
    if (this.running) throw new Error("a run is in progress");
    this.running = true;
    this.emit("state", this.snapshot());
    try {
      this.runId = Date.now().toString(36);
      this.diffCache.clear();
      this.metricsCache.clear();
      this.lastBisect = undefined;
      await this.store.reset(this.runId);
      const { files, info } = seedFiles();
      this.seedInfo = info;
      await this.store.create("_base", files);
      const snap = await this.store.snapshot("_base", "base");
      this.worlds = [{ id: "base", label: "base", parent: null, kind: "base", createdAt: Date.now(), snapshotMs: snap.ms, ref: snap.ref }];
      this.defs = AGENTS;
      this.swarmSize = 0;
      this.agents = AGENTS.map((a) => ({ id: a.id, name: a.name, role: a.role, status: "idle", mode: "scripted", stepsDone: 0, stepsTotal: a.steps.length }));
      this.persist();
    } finally {
      this.running = false;
      this.emit("state", this.snapshot());
    }
  }

  /** Fork the base world once per agent and run all agents concurrently, checkpointing after each step. */
  async runAgents(mode: "scripted" | "llm" = "scripted", swarm = 0): Promise<void> {
    if (this.running) throw new Error("a run is already in progress");
    if (!this.worlds.some((w) => w.id === "base")) await this.seed();
    if (mode === "llm" && !llmAvailable()) mode = "scripted";
    this.running = true;
    this.diffCache.clear();
    this.metricsCache.clear();
    this.lastBisect = undefined;
    this.worlds = this.worlds.filter((w) => w.kind === "base");
    this.swarmSize = Math.max(0, Math.min(50, Math.floor(swarm)));
    this.defs = this.swarmSize ? swarmDefs(this.swarmSize) : AGENTS;
    if (this.swarmSize) mode = "scripted";
    this.agents = this.defs.map((a) => ({ id: a.id, name: a.name, role: a.role, status: "running", mode, stepsDone: 0, stepsTotal: mode === "llm" ? 8 : activeSteps(a).length }));
    const prep = (this.store as unknown as { prepareAgents?: (k: string[]) => Promise<unknown> }).prepareAgents;
    if (prep) {
      try {
        this.diskMode = await prep.call(this.store, this.defs.map((d) => d.id));
      } catch (e) {
        console.warn("per-agent disks unavailable:", (e as Error).message);
      }
    }
    this.emit("state", this.snapshot());
    try {
      // All agent loops run here, in this one process. Bounded concurrency keeps a 50-agent swarm polite to the backend.
      const queue = this.defs.map((a) => a.id);
      const workers = Array.from({ length: Math.min(queue.length, 12) }, async () => {
        for (let id = queue.shift(); id; id = queue.shift()) await this.runOne(id, mode);
      });
      await Promise.all(workers);
    } finally {
      this.running = false;
      this.persist();
      this.emit("state", this.snapshot());
    }
  }

  private async runOne(agentId: string, mode: "scripted" | "llm"): Promise<void> {
    const def = this.defs.find((a) => a.id === agentId)!;
    const st = this.agents.find((a) => a.id === agentId)!;
    const work = `_${agentId}`;
    try {
      const fork = await this.store.fork("_base", work);
      st.forkMs = fork.ms;
      this.emit("agent", st);
      let step = 0;
      const checkpoint = async (name: string, thought: string, calls: ToolCall[], stepMs: number) => {
        step++;
        const id = `${agentId}@${step}`;
        const snap = await this.store.snapshot(work, id);
        const prev = step === 1 ? "base" : `${agentId}@${step - 1}`;
        const meta: WorldMeta = {
          id, label: `${def.name} · step ${step}`, parent: prev, kind: "checkpoint", agent: agentId, step,
          stepName: name, thought, calls, createdAt: Date.now(), snapshotMs: snap.ms, stepMs, ref: snap.ref,
        };
        this.worlds.push(meta);
        st.stepsDone = step;
        st.currentStep = undefined;
        this.emit("world", meta);
        this.emit("agent", st);
      };
      if (mode === "scripted") {
        for (const s of activeSteps(def)) {
          st.currentStep = s.name;
          this.emit("agent", st);
          const ctx = new StepContext(this.store, work, this.paceMs, (c) => this.emit("call", { agent: agentId, call: c }));
          const t = performance.now();
          await s.run(ctx);
          await checkpoint(s.name, s.thought, ctx.calls, Math.round(performance.now() - t));
        }
      } else {
        let t = performance.now();
        await runLlmAgent(def, this.store, work, async (s) => {
          await checkpoint(s.name, s.thought, s.calls, Math.round(performance.now() - t));
          t = performance.now();
        }, (c) => this.emit("call", { agent: agentId, call: c }));
        st.stepsTotal = step;
      }
      st.status = "done";
    } catch (e) {
      st.status = "error";
      st.error = String((e as Error).message).slice(0, 300);
      console.error(`agent ${agentId} failed:`, e);
    } finally {
      this.emit("agent", st);
    }
  }

  head(agentId: string): string | undefined {
    const st = this.agents.find((a) => a.id === agentId);
    if (st?.rolledBackTo !== undefined) return st.rolledBackTo === 0 ? "base" : `${agentId}@${st.rolledBackTo}`;
    const ws = this.worlds.filter((w) => w.agent === agentId).sort((a, b) => (b.step ?? 0) - (a.step ?? 0));
    return ws[0]?.id;
  }

  private exists(id: string) {
    return this.worlds.some((w) => w.id === id);
  }

  diff(from: string, to: string): Promise<WorldDiffResult> {
    if (!this.exists(from) || !this.exists(to)) return Promise.reject(new Error(`unknown world ${!this.exists(from) ? from : to}`));
    const key = `${from}->${to}`;
    let p = this.diffCache.get(key);
    if (!p) {
      p = diffWorlds(this.store.reader(from), this.store.reader(to), { from, to });
      p.catch(() => this.diffCache.delete(key));
      this.diffCache.set(key, p);
    }
    return p;
  }

  async fileDetail(from: string, to: string, path: string): Promise<{ detail: FileDetail | undefined; git: unknown }> {
    const r = await this.diff(from, to);
    const fc = r.summary.files.find((f) => f.path === path);
    let git = null;
    if (fc) {
      try {
        git = await gitView(this.store.reader(from), this.store.reader(to), fc);
      } catch (e) {
        git = { error: (e as Error).message };
      }
    }
    return { detail: r.details.get(path), git };
  }

  async summaries(): Promise<{ agent: string; name: string; head: string; diff: WorldDiff }[]> {
    const out: { agent: string; name: string; head: string; diff: WorldDiff }[] = [];
    if (this.running) return out; // worlds are being replaced; the client reloads when the run ends
    for (const a of this.agents) {
      const head = this.head(a.id);
      if (!head || a.status === "running") continue;
      try {
        const r = await this.diff("base", head);
        out.push({ agent: a.id, name: a.name, head, diff: r.summary });
      } catch {
        /* a world vanished mid-request (reset); skip it */
      }
    }
    return out;
  }

  /** Everything the "What went wrong" panel needs for one broken agent, plus a ready-to-paste fix prompt. */
  async incident(agentId: string) {
    if (this.running) throw new Error("a run is in progress");
    const a = this.agents.find((x) => x.id === agentId);
    if (!a) throw new Error(`unknown agent ${agentId}`);
    const steps = this.worlds.filter((w) => w.agent === agentId && w.kind === "checkpoint").sort((x, y) => (x.step ?? 0) - (y.step ?? 0));
    const end = steps[steps.length - 1];
    if (!end) throw new Error("run the agents first");
    const reader = this.store.reader(end.id);
    const rules = [];
    for (const p of this.presets()) {
      const r = await evaluateInvariant(p.expr, reader);
      if (r.ok) continue;
      const b = await this.bisect(agentId, p.expr, true);
      const bad = steps.find((w) => w.id === b.firstBad);
      rules.push({ label: p.label, expr: p.expr, value: r.value, firstBad: b.firstBad, step: bad?.step, stepName: bad?.stepName, thought: bad?.thought, checks: b.bisectChecks });
    }
    const d = await this.diff("base", end.id);
    const csv = d.details.get("customers.csv");
    const lost: Record<string, unknown>[] = [];
    let merged = 0;
    if (csv?.type === "csv") {
      const t = csv.table;
      const keys = new Set(t.twins?.unmatchedKeys ?? []);
      for (const row of t.removed) if (!t.twins || keys.has(String(row[t.key[0]]))) lost.push({ id: row.id, name: row.name, email: row.email, company: row.company, country: row.country });
      merged = t.twins ? t.twins.matched : 0;
    }
    const db = d.details.get("crm.sqlite");
    const deals: { id: unknown; before: unknown; after: unknown; customer?: unknown }[] = [];
    if (db?.type === "sqlite") {
      const t = db.tables.find((x) => x.name === "deals");
      for (const c of t?.changed ?? []) if (c.cells.amount) deals.push({ id: c.key, before: c.cells.amount.before, after: c.cells.amount.after, customer: c.row.customer_id });
    }
    const firstBadStep = Math.min(...rules.map((r) => r.step ?? Infinity));
    const lastGood = Number.isFinite(firstBadStep) ? (firstBadStep > 1 ? steps.find((w) => w.step === firstBadStep - 1) : undefined) : end;
    const restore = lastGood ? { world: lastGood.id, ref: lastGood.ref, stepName: lastGood.stepName } : { world: "base", ref: this.worlds.find((w) => w.id === "base")?.ref, stepName: "original data" };
    const def = this.defs.find((x) => x.id === agentId) ?? AGENTS.find((x) => x.id === agentId);
    const goal = def?.goal ?? a.role;
    const parts: string[] = [];
    const lostRule = rules.find((r) => /Customers/.test(r.label));
    const dealRule = rules.find((r) => /deal value/i.test(r.label));
    if (lost.length) parts.push(`deleted ${lost.length.toLocaleString("en-US")} customers${lostRule?.step ? ` at step ${lostRule.step} (${lostRule.stepName})` : ""}`);
    const shifted = deals.filter((x) => Number(x.before) && Number(x.after) && (Number(x.after) / Number(x.before) <= 0.1 || Number(x.after) / Number(x.before) >= 10));
    if (shifted.length) parts.push(`divided ${shifted.length.toLocaleString("en-US")} deal amounts by 100${dealRule?.step ? ` at step ${dealRule.step}` : ""}`);
    const sentence = rules.length ? `${a.name} ${parts.join(" and ") || `broke ${rules.length} rule${rules.length === 1 ? "" : "s"}`}.` : `${a.name} passed every rule.`;
    const csvRows = ["id,name,email,company,country", ...lost.map((r) => [r.id, r.name, r.email, r.company, r.country].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const ex = lost.slice(0, 10).map((r) => `| ${r.id} | ${r.name} | ${r.email} | ${r.company} |`).join("\n");
    const backend = this.store.info();
    const prompt = [
      `# Fix request: ${a.name} damaged the customer data`,
      ``,
      `## What the agent was asked to do`,
      goal,
      ``,
      `## What went wrong`,
      `- ${sentence}`,
      ...rules.map((r) => `- Rule broken: **${r.label}** (\`${r.expr}\`; now ${r.value}). First bad step: **step ${r.step} — ${r.stepName}** (found by bisect in ${r.checks} checks).${r.thought ? ` The agent's reasoning at that step: "${r.thought}"` : ""}`),
      merged ? `- For reference: ${merged} removed rows were true duplicates (same email survives) and are fine to merge.` : ``,
      ``,
      lost.length ? `## Example lost customers (${lost.length} total; full list attached as missing_customers.csv)` : ``,
      lost.length ? `| id | name | email | company |\n|---|---|---|---|\n${ex}` : ``,
      shifted.length ? `\n## Damaged deals\n${shifted.length} deal amounts were divided by 100 (e.g. deal ${shifted[0].id}: ${shifted[0].before} → ${shifted[0].after}). Amounts are whole US dollars, not cents.` : ``,
      ``,
      `## Restore point`,
      `- Checkpoint: **${restore.world}** (${restore.stepName})${restore.ref ? `, ${backend.kind === "archil" ? "Archil checkpoint" : "checkpoint"} \`${restore.ref}\`` : " (local checkpoint)"}${backend.kind === "archil" ? ` on disk ${backend.detail}` : ""}`,
      ``,
      `## Instructions`,
      `1. Restore customers.csv and crm.sqlite from checkpoint ${restore.world}${restore.ref ? ` (\`${restore.ref}\`)` : ""}.`,
      `2. Redo the merge using exact email match only (case-insensitive). Do not merge people whose emails differ, even if their names look alike.`,
      `3. Do not change deal amounts; they are in dollars.`,
      `4. Verify before finishing: \`rows(customers.csv) >= ${this.seedInfo?.uniquePeople ?? 4913}\` and total deal value preserved (\`select round(sum(amount)) from deals\` unchanged).`,
    ]
      .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
      .join("\n");
    return { agent: a.id, name: a.name, end: end.id, sentence, rules, lost, lostCount: lost.length, merged, deals: shifted, restore, prompt, csv: csvRows };
  }

  forkVariants() {
    return FORK_VARIANTS;
  }

  /**
   * Fork from a checkpoint and continue with a safe agent: a real Archil branch (or APFS clone) of the checkpoint,
   * a working copy of that version, then the variant's remaining steps, each checkpointed. Step numbers continue
   * from the fork point so lanes line up.
   */
  async forkAndContinue(worldId: string, variant: string) {
    if (this.running) throw new Error("a run is in progress");
    const src = this.worlds.find((x) => x.id === worldId);
    if (!src || src.kind !== "checkpoint" || !src.agent) throw new Error(`${worldId} is not an agent checkpoint`);
    const base = forkVariantDef(variant);
    if (!base) throw new Error(`unknown variant ${variant}`);
    const srcAgent = this.agents.find((a) => a.id === src.agent)!;
    const done = new Set(this.worlds.filter((w) => w.agent === src.agent && w.kind === "checkpoint" && (w.step ?? 0) <= (src.step ?? 0)).map((w) => w.stepName));
    const steps = base.steps.filter((s) => !done.has(s.name) && (!s.when || s.when()));
    const n = this.agents.filter((a) => a.forkOf).length + 1;
    const id = `F${n}`;
    const def: AgentDef = { ...base, id, steps };
    this.running = true;
    const st: AgentState = {
      id, name: variant, role: `continues ${srcAgent.name} from step ${src.step}`, status: "running", mode: "scripted",
      stepsDone: 0, stepsTotal: steps.length, forkOf: src.id, forkSource: srcAgent.name,
    };
    this.agents.push(st);
    this.emit("state", this.snapshot());
    try {
      const t0 = performance.now();
      const br = await this.store.branch(src.id, `${src.id}.${id}`);
      st.forkRef = br.ref;
      // working copy of that version (read through the checkpoint, so it works on both backends)
      const r = this.store.reader(src.id);
      const m = await r.manifest();
      const files: Record<string, Buffer> = {};
      for (const p of Object.keys(m)) files[p] = await r.read(p);
      await this.store.create(`_${id}`, files);
      st.forkMs = Math.round(performance.now() - t0);
      this.emit("agent", st);
      let step = src.step ?? 0;
      let prev = src.id;
      for (const s of steps) {
        st.currentStep = s.name;
        this.emit("agent", st);
        const ctx = new StepContext(this.store, `_${id}`, this.paceMs, (c) => this.emit("call", { agent: id, call: c }));
        const t = performance.now();
        await s.run(ctx);
        step++;
        const wid = `${id}@${step}`;
        const snap = await this.store.snapshot(`_${id}`, wid);
        const meta: WorldMeta = {
          id: wid, label: `${variant} · step ${step}`, parent: prev, kind: "checkpoint", agent: id, step, stepName: s.name, thought: s.thought,
          calls: ctx.calls, createdAt: Date.now(), snapshotMs: snap.ms, stepMs: Math.round(performance.now() - t), ref: snap.ref,
        };
        prev = wid;
        this.worlds.push(meta);
        st.stepsDone++;
        st.currentStep = undefined;
        this.emit("world", meta);
        this.emit("agent", st);
      }
      st.status = "done";
      this.defs = [...this.defs.filter((d) => d.id !== id), def];
      return { agent: st, head: prev, branchRef: br.ref, branchMs: br.ms };
    } catch (e) {
      st.status = "error";
      st.error = String((e as Error).message).slice(0, 300);
      throw e;
    } finally {
      this.running = false;
      this.persist();
      this.emit("agent", st);
      this.emit("state", this.snapshot());
    }
  }

  /** Roll an agent's live world back to one of its checkpoints. History stays (checkpoints are immutable). */
  async rollbackTo(worldId: string) {
    if (this.running) throw new Error("a run is in progress");
    const w = this.worlds.find((x) => x.id === worldId);
    if (!w || w.kind !== "checkpoint" || !w.agent) throw new Error(`${worldId} is not an agent checkpoint`);
    const st = this.agents.find((a) => a.id === w.agent)!;
    const r = await this.store.rollback(`_${w.agent}`, w.id);
    st.rolledBackTo = w.step;
    st.rollback = { ...r, at: Date.now() };
    this.persist();
    this.emit("state", this.snapshot());
    return { agent: st, result: r };
  }

  /** Undo a rollback marker: the agent's head is its latest checkpoint again (live world restored to it). */
  async rollForward(agentId: string) {
    const st = this.agents.find((a) => a.id === agentId);
    if (!st || st.rolledBackTo === undefined) throw new Error("agent is not rolled back");
    st.rolledBackTo = undefined;
    const head = this.head(agentId);
    if (head) await this.store.rollback(`_${agentId}`, head);
    st.rollback = undefined;
    this.persist();
    this.emit("state", this.snapshot());
    return st;
  }

  /** New world that starts at a checkpoint (Archil: a real branch). */
  async forkFrom(worldId: string) {
    if (this.running) throw new Error("a run is in progress");
    const w = this.worlds.find((x) => x.id === worldId);
    if (!w || (w.kind !== "checkpoint" && w.kind !== "base")) throw new Error(`${worldId} is not a checkpoint`);
    const n = this.worlds.filter((x) => x.forkOf === worldId).length + 1;
    const id = `${worldId}.f${n}`;
    const r = await this.store.branch(worldId, id);
    const meta: WorldMeta = {
      id, label: `fork ${n} of ${worldId}`, parent: worldId, kind: "fork", forkOf: worldId, branchRef: r.ref,
      createdAt: Date.now(), snapshotMs: r.ms, ref: r.ref, stepName: `fork of ${worldId}`,
    };
    this.worlds.push(meta);
    this.persist();
    const { frozen, ...pub } = meta;
    this.emit("world", pub);
    this.emit("state", this.snapshot());
    return pub;
  }

  async history(agentId: string, query: string) {
    const steps = this.worlds.filter((w) => w.agent === agentId && w.kind === "checkpoint").sort((a, b) => a.step! - b.step!);
    if (!steps.length) throw new Error("run the agents first");
    const chain = [{ world: "base", step: 0, stepName: "base" }, ...steps.map((w) => ({ world: w.id, step: w.step!, stepName: w.stepName }))];
    return historySearch(query, agentId, chain, (w) => this.store.reader(w));
  }

  /** Check every invariant preset at every agent's head: which agents are clean, which broke something. */
  async review() {
    if (this.running) return { busy: true, clean: 0, broken: 0, rows: [] as never[] };
    const presets = this.presets();
    const rows = await Promise.all(
      this.agents.map(async (a) => {
        const head = this.head(a.id);
        if (!head || a.status === "running") return null;
        const checks = await Promise.all(
          presets.map(async (p) => ({ preset: p.id, label: p.label, expr: p.expr, ...(await evaluateInvariant(p.expr, this.store.reader(head))) })),
        );
        return { agent: a.id, name: a.name, head, ok: checks.every((c) => c.ok), failed: checks.filter((c) => !c.ok) };
      }),
    );
    const list = rows.filter((r): r is NonNullable<typeof r> => !!r);
    return { clean: list.filter((r) => r.ok).length, broken: list.filter((r) => !r.ok).length, rows: list };
  }

  /** Bisect every (agent, failed invariant) pair from the review, without UI pacing. */
  async bisectRogues() {
    const r = await this.review();
    if ("busy" in r) return [];
    const pace = this.paceMs;
    this.paceMs = 0;
    const out: { agent: string; preset: string; firstBad?: string; stepName?: string; checks: number }[] = [];
    try {
      for (const row of r.rows)
        for (const f of row.failed) {
          const b = await this.bisect(row.agent, f.expr, true);
          out.push({ agent: row.agent, preset: f.label, firstBad: b.firstBad, stepName: b.stepName, checks: b.bisectChecks });
        }
    } finally {
      this.paceMs = pace;
    }
    return out;
  }

  private metricsCache = new Map<string, { customers: number | null; dealTotal: number | null; invariants: { label: string; ok: boolean }[] }>();

  /** Per-checkpoint metrics for the Network page: customers.csv rows, total deal value, invariant results. Cached (checkpoints are immutable). */
  private async worldMetrics(id: string) {
    const hit = this.metricsCache.get(id);
    if (hit) return hit;
    const r = this.store.reader(id);
    const m = await r.manifest();
    let customers: number | null = null;
    let dealTotal: number | null = null;
    if (m["customers.csv"]) customers = parseCsv((await r.read("customers.csv")).toString("utf8")).rows.length;
    if (m["crm.sqlite"]) {
      let p = r.localPath?.("crm.sqlite") ?? null;
      if (!p) {
        const dir = join(tmpdir(), "delta-sqlite-cache");
        mkdirS(dir, { recursive: true });
        p = join(dir, `${m["crm.sqlite"].hash}.sqlite`);
        if (!existsS(p)) writeS(p, await r.read("crm.sqlite"));
      }
      try {
        dealTotal = Number(sqliteScalar(p, "select round(sum(amount)) from deals"));
      } catch {
        dealTotal = null;
      }
    }
    const invariants = await Promise.all(this.presets().map(async (pr) => ({ label: pr.label, ok: (await evaluateInvariant(pr.expr, r)).ok })));
    const out = { customers, dealTotal, invariants };
    this.metricsCache.set(id, out);
    return out;
  }

  /** Everything the Network page draws, per agent and per checkpoint. */
  async network() {
    if (this.running) return { busy: true };
    const base = await this.worldMetrics("base");
    const agents = [];
    for (const a of this.agents) {
      const steps = this.worlds.filter((w) => w.agent === a.id && w.kind === "checkpoint").sort((x, y) => x.step! - y.step!);
      const rows = [];
      for (const w of steps) {
        const d = (await this.diff(w.parent ?? "base", w.id)).summary;
        const met = await this.worldMetrics(w.id);
        const t = d.totals;
        const schema = d.files.some((f) => (f.stats.columnsAdded ?? 0) + (f.stats.columnsRemoved ?? 0) > 0);
        const kind = t.rowsRemoved > 0 || t.filesRemoved > 0 ? "delete" : schema ? "schema" : t.rowsChanged + t.cellsChanged + t.filesModified > 0 ? "modify" : t.rowsAdded + t.filesAdded + t.filesRenamed > 0 ? "add" : "none";
        rows.push({
          world: w.id, step: w.step, stepName: w.stepName, ref: w.ref, snapshotMs: w.snapshotMs, stepMs: w.stepMs,
          files: d.files.length, rowsAdded: t.rowsAdded, rowsRemoved: t.rowsRemoved, rowsChanged: t.rowsChanged, cellsChanged: t.cellsChanged,
          columnsAdded: t.columnsAdded, kind, warn: d.highlights.filter((h) => h.level === "warn").length, ...met,
        });
      }
      agents.push({ id: a.id, steps: rows });
    }
    return { base, agents, backend: this.store.info().label };
  }

  async bisect(agentId: string, invariant: string, quiet = false): Promise<BisectResult> {
    const steps = this.worlds.filter((w) => w.agent === agentId && w.kind === "checkpoint").sort((a, b) => a.step! - b.step!);
    const chain = ["base", ...steps.map((s) => s.id)];
    const n = chain.length - 1;
    const res: BisectResult = { agent: agentId, invariant, checks: [], verdict: "error", bisectChecks: 0, totalSteps: n };
    if (!quiet) this.emit("bisect", { ...res, phase: "start" });
    const pause = Math.max(this.paceMs * 1.6, 0);
    const check = async (i: number, phase: BisectCheck["phase"]) => {
      const r = await evaluateInvariant(invariant, this.store.reader(chain[i]));
      if (r.error) throw new Error(r.error);
      const c: BisectCheck = { world: chain[i], step: i, ok: r.ok, value: r.value, phase };
      res.checks.push(c);
      if (phase === "bisect") res.bisectChecks++;
      if (!quiet) {
        this.emit("bisect", { ...res, phase: "check" });
        await sleep(pause);
      }
      return r.ok;
    };
    try {
      if (n === 0) throw new Error("this agent has no checkpoints yet; run the agents first");
      if (await check(n, "endpoint")) res.verdict = "holds";
      else if (!(await check(0, "endpoint"))) res.verdict = "broken-at-base";
      else {
        let lo = 0;
        let hi = n;
        while (hi - lo > 1) {
          const mid = Math.floor((lo + hi) / 2);
          if (await check(mid, "bisect")) lo = mid;
          else hi = mid;
        }
        res.verdict = "found";
        res.firstBad = chain[hi];
        res.lastGood = chain[lo];
        res.stepName = steps.find((s) => s.id === chain[hi])?.stepName;
      }
    } catch (e) {
      res.verdict = "error";
      res.error = (e as Error).message;
    }
    if (!quiet) {
      this.lastBisect = res;
      this.persist();
      this.emit("bisect", { ...res, phase: "done" });
    }
    return res;
  }
}
