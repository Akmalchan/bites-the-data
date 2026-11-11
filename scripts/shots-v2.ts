// Headless walk through the v2 dashboard (light theme) -> shots/v2/.
//   npm run dev   then   npx tsx scripts/shots-v2.ts [--url http://localhost:5177]
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";
const args = process.argv.slice(2);
const url = args.includes("--url") ? args[args.indexOf("--url") + 1] : "http://localhost:5177";
const out = "shots/v2";
mkdirSync(out, { recursive: true });
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 940 }, deviceScaleFactor: 2, colorScheme: "light" });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = async (n: string) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${n}.png` });
  console.log(`saved ${out}/${n}.png`);
};
await page.addInitScript(() => localStorage.setItem("delta-theme", "light"));
await page.goto(`${url}/app#overview`);
await page.getByRole("button", { name: "Reset world" }).click();
await page.waitForSelector('[data-testid="run"][disabled]', { timeout: 10_000 }).catch(() => {});
await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: 60_000 });
await page.getByTestId("swarm").selectOption("0");
await page.getByTestId("run").click();
await page.waitForTimeout(1500);
await shot("01-overview-running");
await page.waitForSelector('[data-testid="run"]:has-text("Run agents")', { timeout: 400_000 });
await page.waitForSelector('[data-testid="gdot-B@4"].bad', { timeout: 120_000 });
await shot("02-overview-graph");
console.log("graph: B@4 is red");

await page.getByTestId("gdot-B@4").click();
await page.waitForSelector('[data-testid="file-customers.csv"]');
await page.getByTestId("quick-B").click();
await page.getByTestId("file-customers.csv").click();
await page.waitForSelector('[data-testid="table-removed"]');
await shot("03-compare-312-lost");
console.log(`delta says: ${await page.getByTestId("deltaview").innerText()} | git says: ${await page.getByTestId("gitview").innerText()}`);

await page.getByTestId("nav-bisect").click();
await page.getByTestId("bisect-run").click();
await page.waitForSelector('[data-testid="bisect-verdict"]', { timeout: 60_000 });
await shot("04-bisect");
console.log(`bisect: ${(await page.getByTestId("bisect-verdict").locator("h4").innerText()).trim()}`);

await page.getByTestId("nav-history").click();
await page.getByTestId("history-input").fill("Carla Roberts");
await page.getByTestId("history-run").click();
await page.waitForSelector('[data-testid="history-result"]');
await shot("05-history");
console.log(`history: ${(await page.getByTestId("history-result").locator(".answer").innerText()).trim()}`);

await page.getByTestId("nav-compare").click();
if (!(await page.getByTestId("node-B@3").count())) await page.getByTestId("tree-B").click();
await page.waitForSelector('[data-testid="node-B@3"]');
await page.getByTestId("node-B@3").hover();
await shot("06-compare-tree-hover");
await page.getByTestId("rollback-B@3").click();
await page.waitForTimeout(1200);
await page.getByTestId("nav-overview").click();
await page.waitForSelector('[data-testid="rolled-B"]', { timeout: 60_000 });
await shot("07-overview-rolled-back");
console.log(`rollback: ${await page.getByTestId("rolled-B").innerText()}`);

await page.getByTestId("swarm").selectOption("8");
await page.getByTestId("run").click();
await page.waitForTimeout(1200);
await page.waitForSelector('[data-testid="run"]:has-text("Run agents")', { timeout: 400_000 });
await page.getByTestId("nav-swarm").click();
await page.waitForSelector('[data-testid="tile-S3"].bad', { timeout: 120_000 });
await shot("08-swarm-tiles");
console.log(`swarm tiles: ${await page.locator(".tile.ok").count()} clean, ${await page.locator(".tile.bad").count()} rogue`);
await page.getByTestId("nav-overview").click();
await page.waitForTimeout(800);
await shot("09-overview-swarm-graph");

await page.goto(`${url}/app?classic=1`);
await page.waitForSelector('[data-testid="run"]');
await shot("10-classic-fallback");
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors");
await browser.close();
