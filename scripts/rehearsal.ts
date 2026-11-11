// Final rehearsal of the main demo path; prints PASS/FAIL per step and timings.
//   npx tsx scripts/rehearsal.ts --url http://localhost:5178
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";
const args = process.argv.slice(2);
const url = args.includes("--url") ? args[args.indexOf("--url") + 1] : "http://localhost:5177";
const out = "shots/rehearsal";
mkdirSync(out, { recursive: true });
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 940 }, deviceScaleFactor: 2, colorScheme: "light" });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.request().method()} ${r.url()}`));
const results: [string, boolean, string][] = [];
const step = async (name: string, fn: () => Promise<string>) => {
  try {
    const note = await fn();
    results.push([name, true, note]);
    console.log(`PASS  ${name}  ${note}`);
  } catch (e) {
    results.push([name, false, String((e as Error).message).split("\n")[0]]);
    console.log(`FAIL  ${name}  ${String((e as Error).message).split("\n")[0]}`);
  }
};
const shot = (n: string) => page.screenshot({ path: `${out}/${n}.png` });

await page.goto(`${url}/app`);
await step("reset world (GEARGO catalog)", async () => {
  await page.waitForFunction(async () => (async (j) => j.scenario === "geargo" && !j.running)(await (await fetch("/api/state")).json()), null, { timeout: 120_000, polling: 500 });
  await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: 120_000 });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.waitForSelector('[data-testid="run"][disabled]', { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: 120_000 });
  return "";
});
let runMs = 0;
await step("run the GEARGO team of 8", async () => {
  const t = Date.now();
  await page.getByTestId("run").click();
  await page.waitForSelector('[data-testid="run"][disabled]', { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: 600_000 });
  runMs = Date.now() - t;
  await page.waitForSelector('[data-testid="wrong-G2"]', { timeout: 180_000 });
  await shot("01-run");
  const rv = await page.evaluate(async () => (await (await fetch("/api/review")).json()).rows as { agent: string; ok: boolean }[]);
  const bad = rv.filter((r) => !r.ok).map((r) => r.agent).join(",");
  if (rv.length !== 8 || bad !== "G2,G4,G5,G6") throw new Error(`review: ${rv.length} agents, rogue ${bad}`);
  return `${(runMs / 1000).toFixed(1)} s; ${rv.length - 4} clean · 4 broke rules (${bad})`;
});
await step("red card -> what went wrong", async () => {
  await page.getByTestId("wrong-G2").click();
  await page.waitForSelector('[data-testid="incident-sentence"]', { timeout: 120_000 });
  const s = (await page.getByTestId("incident-sentence").innerText()).trim();
  if (!/removed|deleted/.test(s)) throw new Error(`unexpected sentence: ${s}`);
  const tabs = (await page.locator(".inc-tabs").innerText()).replace(/\s+/g, " ");
  await shot("02-incident");
  return `${s} | tabs: ${tabs}`;
});
await step("copy fix prompt", async () => {
  await page.getByTestId("copy-prompt").click();
  await page.waitForTimeout(400);
  const clip = String(await page.evaluate("navigator.clipboard.readText()"));
  if (!clip.startsWith("# Fix request")) throw new Error("clipboard empty");
  const ref = clip.match(/checkpoint `([^`]+)`/)?.[1];
  return `${clip.length} chars; restore from ${ref ?? "?"}`;
});
let fixMs = 0;
await step("fix it: fork from the last good step", async () => {
  const t = Date.now();
  await page.getByTestId("fix-fork").click();
  await page.waitForSelector('[data-testid="group-F1"]', { timeout: 300_000 });
  await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: 300_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="report-summary"]')?.textContent?.includes("restored"), null, { timeout: 120_000 });
  fixMs = Date.now() - t;
  await page.waitForTimeout(3200); // the "0 customers lost" toast
  const toast = (await page.locator(".toast").innerText().catch(() => "")).trim();
  await shot("03-fixed");
  const sentence = (await page.getByTestId("report-summary").locator(".rep-sentence").innerText()).trim();
  return `${(fixMs / 1000).toFixed(1)} s | ${sentence} | toast: ${toast}`;
});
await step("compare base -> fork end shows 0 lost", async () => {
  const head = await page.getByTestId("to").inputValue();
  const d = await page.evaluate(async (h) => (await fetch(`/api/diff?from=base&to=${encodeURIComponent(h)}`)).json(), head);
  const lost = Math.max(0, ...d.files.map((f: { stats: { rowsLost?: number } }) => f.stats.rowsLost ?? 0));
  if (lost !== 0) throw new Error(`lost = ${lost}`);
  const merged = Math.max(0, ...d.files.filter((f: { kind: string }) => f.kind === "csv").map((f: { stats: { rowsRemoved?: number } }) => f.stats.rowsRemoved ?? 0));
  return `base -> ${head}: 0 lost, ${merged} merged`;
});
await step("roll back G6 (stock sync) to step 5", async () => {
  if (!(await page.getByTestId("node-G6@5").count())) await page.getByTestId("group-G6").click();
  await page.getByTestId("node-G6@5").hover({ force: true });
  await page.getByTestId("rollback-G6@5").click();
  await page.waitForSelector('[data-testid="rolled-G6"]', { timeout: 120_000 });
  return (await page.getByTestId("rolled-G6").innerText()).replace(/\s+/g, " ");
});
await step("network shows the fork lane", async () => {
  await page.getByTestId("nav-network").click();
  await page.waitForSelector('[data-testid="graph"]');
  await page.waitForFunction(() => (document.querySelector('[data-testid="graph"]')?.textContent ?? "").includes("⑂"), null, { timeout: 120_000 });
  await page.waitForTimeout(800);
  await shot("04-network");
  return "fork lane present";
});
let swarmMs = 0;
await step("swarm x 8 (Demo CRM scenario)", async () => {
  await page.goto(`${url}/app?scenario=crm&swarm=8`);
  await page.waitForFunction(async () => (async (j) => j.scenario === "crm" && !j.running)(await (await fetch("/api/state")).json()), null, { timeout: 120_000, polling: 500 });
  await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: 120_000 });
  const t = Date.now();
  await page.getByTestId("run").click();
  await page.waitForSelector('[data-testid="run"][disabled]', { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: 900_000 });
  swarmMs = Date.now() - t;
  await page.getByTestId("nav-swarm").click();
  await page.waitForSelector('[data-testid="tile-S3"].bad', { timeout: 180_000 });
  await shot("05-swarm");
  return `${(swarmMs / 1000).toFixed(1)} s; ${await page.locator(".tile.ok").count()} clean, ${await page.locator(".tile.bad").count()} rogue`;
});
const stats = await page.evaluate(async () => (await (await fetch("/api/state")).json()).backend);
console.log(`backend: ${stats.label} ${stats.detail} | stats ${JSON.stringify(stats.stats ?? {})}`);
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no page errors");
console.log(`${results.filter((r) => r[1]).length}/${results.length} steps passed`);
await browser.close();
