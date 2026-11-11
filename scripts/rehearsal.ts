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
await step("reset world", async () => {
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.waitForSelector('[data-testid="run"][disabled]', { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: 120_000 });
  return "";
});
let runMs = 0;
await step("run 3 agents", async () => {
  await page.getByTestId("swarm-0").click();
  const t = Date.now();
  await page.getByTestId("run").click();
  await page.waitForSelector('[data-testid="run"][disabled]', { timeout: 10_000 }).catch(() => {});
  await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: 600_000 });
  runMs = Date.now() - t;
  await page.waitForSelector('[data-testid="wrong-B"]', { timeout: 180_000 });
  await shot("01-run");
  return `${(runMs / 1000).toFixed(1)} s`;
});
await step("red card -> what went wrong", async () => {
  await page.getByTestId("wrong-B").click();
  await page.waitForSelector('[data-testid="incident-sentence"]', { timeout: 120_000 });
  const s = (await page.getByTestId("incident-sentence").innerText()).trim();
  if (!s.includes("312") || !s.includes("267")) throw new Error(`unexpected sentence: ${s}`);
  const tabs = await page.locator(".inc-tabs").innerText();
  if (!/312/.test(tabs) || !/267/.test(tabs)) throw new Error(`tabs: ${tabs}`);
  await shot("02-incident");
  return s;
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
await step("fix it: fork from step 3 with Merger (exact)", async () => {
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
await step("roll back B to step 3", async () => {
  if (!(await page.getByTestId("node-B@3").count())) await page.getByTestId("group-B").click();
  await page.getByTestId("node-B@3").hover();
  await page.getByTestId("rollback-B@3").click();
  await page.waitForSelector('[data-testid="rolled-B"]', { timeout: 120_000 });
  return (await page.getByTestId("rolled-B").innerText()).replace(/\s+/g, " ");
});
await step("network shows the fork lane", async () => {
  await page.getByTestId("nav-network").click();
  await page.waitForSelector('[data-testid="graph"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="graph"]')?.textContent?.includes("Merger (exact)"), null, { timeout: 120_000 });
  await page.waitForTimeout(800);
  await shot("04-network");
  return "fork lane present";
});
let swarmMs = 0;
await step("swarm x 8", async () => {
  await page.getByTestId("nav-dashboard").click();
  await page.getByTestId("swarm-8").click();
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
