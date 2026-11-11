// Screenshots: the report page, and the PR comment as GitHub renders it (via GitHub's markdown API).
//   npx tsx prcheck/server.ts &   then   npx tsx prcheck/shots.ts --pr 106
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PORT, PRCHECK_DIR, REPORTS_DIR } from "./lib/paths.ts";
import { gh } from "./lib/github.ts";

const n = process.argv.includes("--pr") ? process.argv[process.argv.indexOf("--pr") + 1] : "106";
const repo = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : "Akmalchan/GEARGO";
const out = `${PRCHECK_DIR}/shots`;
mkdirSync(out, { recursive: true });
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true });

const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${PORT}/pr/${n}`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${out}/pr${n}-report.png` });
await page.screenshot({ path: `${out}/pr${n}-report-full.png`, fullPage: true });

// Comment: GitHub's own GFM renderer, wrapped in GitHub-like comment chrome.
const md = readFileSync(`${REPORTS_DIR}/pr${n}.md`, "utf8");
const html = gh(["api", "-X", "POST", "markdown", "--input", "-"], JSON.stringify({ text: md, mode: "gfm", context: repo }));
const doc = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;color:#1f2328;padding:24px}
.c{max-width:900px;border:1px solid #d1d9e0;border-radius:6px;overflow:hidden}
.h{background:#f6f8fa;border-bottom:1px solid #d1d9e0;padding:8px 16px;color:#59636e;font-size:14px}.h b{color:#1f2328}
.b{padding:16px}
h3{font-size:1.25em;margin:0 0 16px;font-weight:600}
table{border-collapse:collapse;margin:0 0 16px;display:block;width:max-content;max-width:100%;overflow:auto}
th,td{border:1px solid #d1d9e0;padding:6px 13px}th{font-weight:600}tr:nth-child(2n){background:#f6f8fa}
code{font:85% ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(129,139,152,.12);border-radius:6px;padding:.2em .4em}
p{margin:0 0 16px}a{color:#0969da;text-decoration:none}sub{color:#59636e}details{margin-bottom:16px}summary{cursor:pointer}
</style><div class="c"><div class="h"><b>Akmalchan</b> commented · Bites the Data</div><div class="b">${html}</div></div>`;
writeFileSync(`${out}/pr${n}-comment.html`, doc);
const cp = await browser.newPage({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 2 });
await cp.setContent(doc, { waitUntil: "load" });
await cp.locator(".c").screenshot({ path: `${out}/pr${n}-comment.png` });
await browser.close();
console.log(`saved ${out}/pr${n}-report.png, pr${n}-report-full.png, pr${n}-comment.png`);
