// Rail popovers + page headers with pixel art -> shots/v6/.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const url = process.argv[2] ?? "http://localhost:5177";
mkdirSync("shots/v6", { recursive: true });
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--force-dark-mode"] });
const p = await b.newPage({ viewport: { width: 1480, height: 940 }, deviceScaleFactor: 2, colorScheme: "dark" });
const errs: string[] = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("response", (r) => r.status() >= 400 && errs.push(`${r.status()} ${r.url()}`));
await p.goto(`${url}/app`);
await p.waitForSelector('[data-testid="nav-dashboard"]');
await p.waitForTimeout(1500);
for (const page of ["dashboard", "network", "bisect", "history", "swarm"]) {
  await p.getByTestId(`nav-${page}`).hover();
  await p.waitForSelector(`[data-testid="railpop-${page}"]`);
  await p.waitForTimeout(250);
  await p.screenshot({ path: `shots/v6/rail-${page}.png`, clip: { x: 0, y: 0, width: 420, height: 360 } });
  await p.getByTestId(`nav-${page}`).click();
  await p.mouse.move(900, 800);
  await p.waitForSelector(`[data-testid="intro-${page}"]`);
  console.log(`${page}: popover closed after click = ${(await p.locator(".rail-pop").count()) === 0}`);
  await p.waitForTimeout(600);
  await p.screenshot({ path: `shots/v6/header-${page}.png`, clip: { x: 0, y: 0, width: 1480, height: 300 } });
}
const tips = await p.evaluate(() => [...document.querySelectorAll("button[title]")].map((x) => `${x.textContent?.trim().slice(0, 14)} = ${x.getAttribute("title")}`).slice(0, 6));
console.log(tips.join("\n"));
console.log(errs.length ? errs : "no page errors");
await b.close();
