// Drives the running app in headless Chrome through the demo path and saves screenshots.
//   npm run dev   (in another terminal)
//   npm run shots [-- --url http://localhost:5177 --theme dark]
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const url = opt("--url", "http://localhost:5177");
const theme = opt("--theme", "dark");
const out = opt("--out", "shots");
mkdirSync(out, { recursive: true });

const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 940 }, deviceScaleFactor: 2, colorScheme: theme === "dark" ? "dark" : "light" });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = async (name: string) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`saved ${out}/${name}.png`);
};

await page.goto(`${url}/app`);
await page.getByRole("button", { name: "Reset world" }).click();
await page.waitForSelector('[data-testid="run"][disabled]', { timeout: 10_000 }).catch(() => {});
await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: 60_000 });
await page.waitForTimeout(500);
await shot(`01-seeded-${theme}`);

await page.getByTestId("run").click();
await page.waitForTimeout(1800);
await shot(`02-running-${theme}`);
await page.waitForSelector('[data-testid="run"]:has-text("Run agents")', { timeout: 400_000 });
await page.waitForSelector('[data-testid="card-B"] .headline', { timeout: 180_000 });
await shot(`03-agents-done-${theme}`);

await page.getByTestId("quick-B").click();
await page.getByTestId("file-customers.csv").click();
await page.waitForSelector('[data-testid="table-removed"]');
await shot(`04-B-customers-deleted-${theme}`);
const removed = await page.locator('[data-testid="table-removed"] tbody tr').count();
const lost = await page.locator('[data-testid="table-removed"] .tag.lost').count();
console.log(`removed rows rendered: ${removed}, tagged lost: ${lost}`);
console.log(`git says: ${await page.getByTestId("gitview").innerText()}`);
console.log(`delta says: ${await page.getByTestId("deltaview").innerText()}`);

await page.getByTestId("file-crm.sqlite").click();
await page.waitForSelector(".tbl-section");
await page.locator(".tbl-section", { hasText: "deals" }).getByTestId("tab-changed").click();
await shot(`05-B-deals-corrupted-${theme}`);

await page.getByTestId("file-config.json").click();
await page.waitForSelector(".json-row");
await shot(`06-B-config-json-${theme}`);

await page.getByTestId("bisect-open").click();
await page.getByTestId("bisect-run").click();
await page.waitForTimeout(1300);
await shot(`07-bisect-running-${theme}`);
await page.waitForSelector('[data-testid="bisect-verdict"]', { timeout: 60_000 });
await shot(`08-bisect-found-${theme}`);
console.log(`bisect: ${(await page.getByTestId("bisect-verdict").locator("h4").innerText()).trim()}`);
console.log(`log:\n${await page.getByTestId("bisect-log").innerText()}`);

await page.getByTestId("bisect-show").click();
await page.waitForTimeout(300);
await page.waitForSelector('[data-testid="file-customers.csv"]');
await page.getByTestId("file-customers.csv").click();
await page.waitForSelector('[data-testid="table-removed"]');
await shot(`09-step4-diff-${theme}`);

await page.getByTestId("quick-A").click();
await page.getByTestId("file-customers.csv").click();
await page.waitForSelector('[data-testid="table-changed"]');
await shot(`10-A-normalizer-${theme}`);

await page.getByTestId("quick-C").click();
await page.getByTestId("file-customers.csv").click();
await page.waitForSelector('[data-testid="tab-changed"]');
await shot(`11-C-enricher-${theme}`);

// Time-travel query: when did Carla Roberts vanish?
await page.getByTestId("history-input").fill("Carla Roberts");
await page.getByTestId("history-run").click();
await page.waitForSelector('[data-testid="history-result"]', { timeout: 60_000 });
await page.evaluate(() => window.scrollTo(0, 0));
await shot(`12a-history-${theme}`);
console.log(`history: ${(await page.getByTestId("history-result").locator(".answer").innerText()).trim()} | ${(await page.getByTestId("history-result").locator(".mono").first().innerText()).trim()}`);

// Roll B back to the last good step, straight from the bisect verdict.
await page.getByTestId("bisect-open").click();
await page.getByTestId("bisect-run").click();
await page.waitForSelector('[data-testid="bisect-rollback"]', { timeout: 60_000 });
await page.getByTestId("bisect-rollback").click();
await page.waitForSelector('[data-testid="rolled-B"]', { timeout: 60_000 });
await page.waitForSelector('[data-testid="card-B"] .headline', { timeout: 180_000 });
await shot(`12b-B-rolled-back-${theme}`);
console.log(`after rollback: ${await page.getByTestId("rolled-B").innerText()} | ${await page.locator('[data-testid="card-B"] .headline').innerText()}`);

// Fork from a checkpoint (real Archil branch on the Archil backend).
await page.getByTestId("node-C@2").hover();
await page.getByTestId("fork-C@2").click();
await page.waitForSelector('[data-testid="node-C@2.f1"]', { timeout: 60_000 });
await shot(`13-fork-${theme}`);
console.log(`fork: ${(await page.getByTestId("node-C@2.f1").innerText()).replace(/\s+/g, " ")}`);

// Provenance: where did C's web-enriched values come from? (only when Keenable is configured)
const webBtn = page.locator(".history-ex .mini", { hasText: "web sources" });
if (await webBtn.count()) {
  await webBtn.click();
  await page.waitForSelector('[data-testid="history-result"] a.src', { timeout: 60_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(`13b-keenable-provenance-${theme}`);
  console.log(`provenance: ${(await page.getByTestId("history-result").locator(".answer").innerText()).trim().slice(0, 220)}`);
  console.log(`keenable badge: ${await page.getByTestId("keenable-badge").first().innerText()}`);
}

// Swarm: fan out N agents from the base world, review all of them, bisect the rogues.
const swarmN = opt("--swarm", "0");
if (swarmN !== "0") {
  await page.getByTestId("swarm").selectOption(swarmN);
  await page.getByTestId("run").click();
  await page.waitForTimeout(1500);
  await shot(`14-swarm-running-${theme}`);
  await page.waitForSelector('[data-testid="run"]:has-text("Run agents")', { timeout: 300_000 });
  await page.waitForSelector('[data-testid="bisect-rogues"]', { timeout: 120_000 });
  await page.getByTestId("bisect-rogues").click();
  await page.waitForSelector(".rogue .mini:has-text('checks')", { timeout: 120_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(`15-swarm-review-${theme}`);
  console.log(`swarm review: ${(await page.getByTestId("review").locator(".review-h").innerText()).replace(/\s+/g, " ")}`);
}

console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors");
await browser.close();
