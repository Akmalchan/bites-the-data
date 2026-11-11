// Screenshots of the landing page (desktop + mobile) into shots/landing/.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const url = process.argv[2] ?? "http://localhost:5177";
const dir = process.argv[3] ?? "shots/landing";
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errs: string[] = [];
for (const [name, vp, dpr] of [["desktop", { width: 1440, height: 900 }, 2], ["mobile", { width: 390, height: 844 }, 3]] as const) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: dpr, colorScheme: "dark" });
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(url + "/");
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${dir}/${name}-00-hero.png` });
  await p.screenshot({ path: `${dir}/${name}-full.png`, fullPage: true });
  console.log(name, "scrollWidth", await p.evaluate(() => document.documentElement.scrollWidth), "vs", vp.width);
  await p.close();
}
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await p.goto(url + "/");
await p.waitForTimeout(1500);
await p.screenshot({ path: `${dir}/desktop-reduced-motion.png` });
await p.getByTestId("landing-cta").click();
await p.waitForURL(/\/app/);
console.log("cta ->", p.url(), "app loaded:", await p.getByTestId("run").count());
console.log(errs.length ? errs.join("\n") : "no page errors");
await b.close();
