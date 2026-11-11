// With the OS in dark mode (emulated), every page must still render light. Also exercises the optional hero-image
// slot with an in-memory test image served via request interception (no file is written to public/).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const url = process.argv[2] ?? "http://localhost:5177";
const out = "shots/light-check";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--force-dark-mode"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const errs: string[] = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const LUM_JS = `(() => {
  function L(el) { if (!el) return null; var m = getComputedStyle(el).backgroundColor.match(/\\d+(\\.\\d+)?/g).map(Number); if (m.length > 3 && m[3] === 0) return null; return Math.round(0.2126*m[0] + 0.7152*m[1] + 0.0722*m[2]); }
  var dark = Array.prototype.slice.call(document.querySelectorAll(".card, .tile, select, input, .topbar, .rail, .tree, .bd-card, table.grid th")).map(L).filter(function (v) { return v !== null && v < 150; }).length;
  return { body: L(document.body), darkSurfaces: dark };
})()`;
const lum = async () => p.evaluate(LUM_JS);
for (const [name, path] of [["app-overview", "/app?p=1#overview"], ["app-compare", "/app?p=2#compare"], ["app-bisect", "/app?p=3#bisect"], ["app-history", "/app?p=4#history"], ["app-swarm", "/app?p=5#swarm"], ["app-classic", "/app?classic=1"], ["landing", "/"]]) {
  await p.goto(url + path);
  await p.waitForTimeout(1800);
  if (name === "app-compare") {
    await p.locator('[data-testid^="quick-"]').first().click().catch(() => {});
    await p.waitForTimeout(1200);
  }
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log(name, JSON.stringify(await lum()));
}
// Hero slot: serve a generated test image for /hero.png from memory.
const art = await b.newPage({ viewport: { width: 400, height: 500 } });
await art.setContent(`<body style="margin:0;background:transparent"><div style="width:400px;height:500px;background:radial-gradient(circle at 50% 35%,#222 0 22%,transparent 23%),linear-gradient(#fff,#888)"></div></body>`);
const png = await art.screenshot({ omitBackground: true });
await p.route("**/hero.png", (r) => r.fulfill({ status: 200, contentType: "image/png", body: png }));
await p.goto(url + "/");
await p.waitForTimeout(2000);
console.log("hero slot rendered:", await p.locator(".bd-art-img").count(), "mini graph present:", await p.locator(".bd-mini").count());
await p.screenshot({ path: `${out}/landing-hero-slot-test.png` });
console.log(errs.length ? errs.join("\n") : "no page errors");
await b.close();
