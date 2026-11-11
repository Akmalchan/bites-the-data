// Renders the logo mark at 16 / 32 / 64 px plus the mark+wordmark into shots/logo.png.
import { chromium } from "playwright-core";
const tri: [number, number][] = [];
for (const x0 of [0, 3]) for (let c = 0; c < 3; c++) for (let r = 3 - c; r <= 4 + c; r++) tri.push([x0 + c, r]);
const trail3: [number, number, number][] = [[7, 1, 1], [7, 3, 1], [7, 4, 1], [7, 6, 1], [8, 2, 0.6], [8, 5, 0.6], [9, 3, 0.25], [9, 4, 0.25]];
const svg = (size: number, trail: 1 | 3) =>
  `<svg width="${size}" height="${(size * 8) / 10}" viewBox="0 0 10 8" shape-rendering="crispEdges"><path fill="#1A2BFF" d="${tri.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("")}"/>${trail3
    .filter(([c]) => c < 7 + trail).map(([x, y, o]) => `<rect x="${x}" y="${y}" width="1" height="1" fill="#1A2BFF" opacity="${o}"/>`).join("")}</svg>`;
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 760, height: 220 }, deviceScaleFactor: 2 });
await p.setContent(`<html><head><style>@font-face{font-family:D;src:url(http://localhost:5177/fonts/archivo-black-latin-400-normal.woff2)}body{margin:0;background:#F5F4F0;font:13px system-ui;color:#5E6270;display:flex;gap:40px;align-items:flex-end;padding:36px}.c{display:flex;flex-direction:column;gap:10px;align-items:center}.w{display:flex;align-items:center;gap:10px;font-family:D;font-size:24px;color:#0D0F14;letter-spacing:-.02em}</style></head><body>
<div class="c">${svg(16, 1)}<span>16 px (favicon, 1-col trail)</span></div>
<div class="c">${svg(32, 3)}<span>32 px</span></div>
<div class="c">${svg(64, 3)}<span>64 px</span></div>
<div class="c"><div class="w">${svg(32, 3)}Bites the Data</div><span>mark + wordmark</span></div></body></html>`);
await p.waitForTimeout(600);
await p.screenshot({ path: "shots/logo.png" });
console.log("saved shots/logo.png");
await b.close();
