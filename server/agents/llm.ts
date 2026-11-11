// LLM mode: a real Claude tool loop (claude-opus-5-5) per agent, restricted to
// its own world. Every mutating tool call (write_file / run_bash) is one step
// and gets a checkpoint, exactly like scripted mode.
import Anthropic from "@anthropic-ai/sdk";
import type { WorldStore } from "../store/types.ts";
import type { ToolCall } from "./context.ts";
import type { AgentDef } from "./scripted.ts";

export const LLM_MODEL = "claude-opus-5-5";
const MAX_STEPS = 8;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 file from your workspace. Paths are relative to the workspace root. Large files are truncated to the first 60,000 characters.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file in your workspace with the given UTF-8 content.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "run_bash",
    description:
      "Run a bash command with the workspace as the working directory (python3, sqlite3, awk, sed are available). Prefer this for bulk edits of customers.csv and crm.sqlite. 30 s timeout.",
    input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false },
  },
];

export interface LlmStep {
  name: string;
  thought: string;
  calls: ToolCall[];
}

export function llmAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Runs the agent until it stops or hits MAX_STEPS mutating calls.
 * `onStep` is awaited after each mutating call so the caller can checkpoint.
 */
export async function runLlmAgent(
  agent: AgentDef,
  store: WorldStore,
  worldId: string,
  onStep: (step: LlmStep) => Promise<void>,
  onCall?: (c: ToolCall) => void,
): Promise<void> {
  const client = new Anthropic();
  const system =
    `You are "${agent.name}", a data-cleaning agent working in a workspace that contains customers.csv, crm.sqlite (tables customers, deals), config.json and notes/. ` +
    `Your job: ${agent.goal} Work in at most ${MAX_STEPS} file-changing tool calls. Be decisive; do not ask questions. ` +
    `Before each tool call, say in one short sentence what you are about to do. When done, reply with a two-line summary.`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: "Start. The workspace is ready." }];
  let steps = 0;
  let pendingCalls: ToolCall[] = [];

  for (let turn = 0; turn < 24 && steps < MAX_STEPS; turn++) {
    const response = await client.beta.messages.create({
      model: LLM_MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },
      system,
      tools: TOOLS,
      messages,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (response.stop_reason === "refusal") throw new Error("model refused the task");
    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join(" ").trim();
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (uses.length === 0) break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const input = use.input as Record<string, string>;
      const t = performance.now();
      let output = "";
      let isError = false;
      let mutating = false;
      try {
        if (use.name === "read_file") {
          const s = (await store.reader(worldId).read(input.path)).toString("utf8");
          output = s.length > 60_000 ? s.slice(0, 60_000) + "\n…[truncated]" : s;
        } else if (use.name === "write_file") {
          await store.write(worldId, input.path, input.content);
          output = `wrote ${input.content.length} chars`;
          mutating = true;
        } else if (use.name === "run_bash") {
          const r = await store.bash(worldId, input.command, 30_000);
          output = `exit ${r.exitCode}\n${r.stdout}${r.stderr ? `\nstderr:\n${r.stderr}` : ""}`.slice(0, 20_000);
          isError = r.exitCode !== 0;
          mutating = true;
        } else {
          output = `unknown tool ${use.name}`;
          isError = true;
        }
      } catch (e) {
        output = String((e as Error).message);
        isError = true;
      }
      const call: ToolCall = {
        tool: use.name,
        input: use.name === "run_bash" ? input.command : input.path,
        output: output.split("\n")[0].slice(0, 120),
        ms: Math.round(performance.now() - t),
      };
      pendingCalls.push(call);
      onCall?.(call);
      results.push({ type: "tool_result", tool_use_id: use.id, content: output, is_error: isError });
      if (mutating) {
        steps++;
        await onStep({ name: stepName(call), thought: text.slice(0, 240), calls: pendingCalls });
        pendingCalls = [];
      }
    }
    messages.push({ role: "user", content: results });
  }
}

function stepName(c: ToolCall): string {
  if (c.tool === "write_file") return `Write ${c.input}`;
  const cmd = c.input.replace(/\s+/g, " ").trim();
  return `Run: ${cmd.length > 60 ? cmd.slice(0, 57) + "…" : cmd}`;
}
