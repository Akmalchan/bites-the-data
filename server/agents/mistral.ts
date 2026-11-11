// One live LLM agent on Mistral (chat completions, OpenAI-style tool calling).
// Tools are restricted to the agent's own world; every file-changing call is one
// step and gets a checkpoint (Archil or local), exactly like scripted steps.
// Any failure throws; the caller falls back to the scripted agent and says so.
import type { WorldStore } from "../store/types.ts";
import type { ToolCall } from "./context.ts";
import type { LlmStep } from "./llm.ts";

export const MISTRAL_MODEL = "mistral-small-latest";
const URL_ = "https://api.mistral.ai/v1/chat/completions";
const MAX_TOOL_CALLS = 8;
const CALL_TIMEOUT_MS = 20_000;

export const mistralAvailable = () => !!process.env.MISTRAL_API_KEY;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 file from your workspace (path relative to the workspace root). Returns at most max_chars characters (default 12000).",
      parameters: { type: "object", properties: { path: { type: "string" }, max_chars: { type: "integer" } }, required: ["path"] },
    },
  },
  {
    type: "function",
    function: {
      name: "merge_json",
      description:
        "Deep-merge `entries` (a JSON object) into the JSON object stored at `path`, keeping every existing key. Use this to add translations without rewriting the whole file.",
      parameters: { type: "object", properties: { path: { type: "string" }, entries: { type: "object" } }, required: ["path", "entries"] },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a small file in your workspace (for notes or reports). Do not use it for translations/products.json.",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    },
  },
  {
    type: "function",
    function: {
      name: "run_bash",
      description: "Run a short read-only bash command (head, cut, grep, wc) with the workspace as working directory. 20 s timeout.",
      parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    },
  },
];

type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

async function chat(messages: Msg[], tools = true, signal?: AbortSignal): Promise<Extract<Msg, { role: "assistant" }>> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.MISTRAL_API_KEY}` },
    body: JSON.stringify({ model: MISTRAL_MODEL, temperature: 0.2, messages, ...(tools ? { tools: TOOLS, tool_choice: "auto" } : {}) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]) : AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Mistral HTTP ${res.status}`);
  const j = (await res.json()) as { choices?: { message?: Extract<Msg, { role: "assistant" }> }[] };
  const m = j.choices?.[0]?.message;
  if (!m) throw new Error("Mistral returned no message");
  return m;
}

/** One-shot question (no tools), used by "Explain with Mistral". */
export async function mistralAnswer(system: string, user: string): Promise<string> {
  const m = await chat([{ role: "system", content: system }, { role: "user", content: user }], false);
  return String(m.content ?? "").trim();
}

const safePath = (p: unknown): string => {
  const s = String(p ?? "").replace(/^\.?\/+/, "");
  if (!s || s.includes("..") || s.startsWith("/")) throw new Error(`path not allowed: ${p}`);
  return s;
};

function deepMerge(into: Record<string, unknown>, add: Record<string, unknown>): number {
  let n = 0;
  for (const [k, v] of Object.entries(add)) {
    const cur = into[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) n += deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    else {
      into[k] = v;
      n++;
    }
  }
  return n;
}

export async function runMistralAgent(
  task: { name: string; goal: string; prompt: string },
  store: WorldStore,
  worldId: string,
  onStep: (step: LlmStep) => Promise<void>,
  onCall?: (c: ToolCall) => void,
  signal?: AbortSignal,
): Promise<{ steps: number; toolCalls: number; summary: string }> {
  const messages: Msg[] = [
    {
      role: "system",
      content:
        `You are "${task.name}", an agent working in a workspace with products.csv (a Vendure product catalog) and translations/products.json. ` +
        `Your job: ${task.goal} You have at most ${MAX_TOOL_CALLS} tool calls. Be decisive; do not ask questions. ` +
        `Before each tool call, say in one short sentence what you are about to do. When done, reply with a one-line summary and no tool call.`,
    },
    { role: "user", content: task.prompt },
  ];
  let steps = 0;
  let toolCalls = 0;
  let pending: ToolCall[] = [];
  let summary = "";
  for (let turn = 0; turn < 10 && toolCalls < MAX_TOOL_CALLS; turn++) {
    if (signal?.aborted) throw new Error("stopped (instant mode)");
    const m = await chat(messages, true, signal);
    messages.push({ role: "assistant", content: m.content ?? "", tool_calls: m.tool_calls });
    const text = String(m.content ?? "").replace(/\s+/g, " ").trim();
    const uses = m.tool_calls ?? [];
    if (!uses.length) {
      summary = text;
      break;
    }
    for (const use of uses) {
      if (toolCalls >= MAX_TOOL_CALLS) {
        messages.push({ role: "tool", tool_call_id: use.id, name: use.function.name, content: "tool budget used up; stop now" });
        continue;
      }
      toolCalls++;
      const t = performance.now();
      let args: Record<string, unknown> = {};
      let output = "";
      let mutating = false;
      let label = "";
      try {
        args = JSON.parse(use.function.arguments || "{}");
        const name = use.function.name;
        if (name === "read_file") {
          const p = safePath(args.path);
          label = p;
          const s = (await store.reader(worldId).read(p)).toString("utf8");
          const max = Math.min(Math.max(Number(args.max_chars) || 12_000, 500), 40_000);
          output = s.length > max ? `${s.slice(0, max)}\n…[truncated, ${s.length} chars total]` : s;
        } else if (name === "merge_json") {
          const p = safePath(args.path);
          const entries = typeof args.entries === "string" ? JSON.parse(args.entries) : args.entries;
          if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("entries must be a JSON object");
          let cur: Record<string, unknown> = {};
          try {
            cur = JSON.parse((await store.reader(worldId).read(p)).toString("utf8"));
          } catch {
            cur = {};
          }
          const n = deepMerge(cur, entries as Record<string, unknown>);
          await store.write(worldId, p, JSON.stringify(cur, null, 2) + "\n");
          label = `${p} (+${Object.keys(entries).length} keys)`;
          output = `merged ${Object.keys(entries).length} top-level keys (${n} values) into ${p}`;
          mutating = true;
        } else if (name === "write_file") {
          const p = safePath(args.path);
          if (p === "translations/products.json" || p === "products.csv") throw new Error(`use merge_json; write_file may not overwrite ${p}`);
          await store.write(worldId, p, String(args.content ?? ""));
          label = p;
          output = `wrote ${String(args.content ?? "").length} chars`;
          mutating = true;
        } else if (name === "run_bash") {
          const cmd = String(args.command ?? "");
          label = cmd;
          if (/>|\brm\b|\bmv\b|\bcp\b|sed\s+-i|\btee\b|curl|wget|python|node|perl|chmod|dd\b/.test(cmd)) throw new Error("only short read-only commands are allowed");
          const r = await store.bash(worldId, cmd, 20_000);
          output = `exit ${r.exitCode}\n${r.stdout}${r.stderr ? `\nstderr:\n${r.stderr}` : ""}`.slice(0, 12_000);
        } else throw new Error(`unknown tool ${name}`);
      } catch (e) {
        output = `error: ${(e as Error).message}`;
        mutating = false;
      }
      const call: ToolCall = { tool: use.function.name, input: label || use.function.arguments.slice(0, 80), output: output.split("\n")[0].slice(0, 120), ms: Math.round(performance.now() - t) };
      pending.push(call);
      onCall?.(call);
      messages.push({ role: "tool", tool_call_id: use.id, name: use.function.name, content: output });
      if (mutating) {
        steps++;
        const trail = pending.map((c) => `${c.tool}(${c.input.slice(0, 60)}) → ${c.output.slice(0, 60)}`).join("; ");
        await onStep({ name: `${call.tool} ${call.input}`.slice(0, 90), thought: `Mistral: ${text ? `“${text.slice(0, 220)}” ` : ""}[${trail}]`.slice(0, 480), calls: pending });
        pending = [];
      }
    }
  }
  return { steps, toolCalls, summary };
}
