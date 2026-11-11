// Bites the Data · PR report pages.  npx tsx prcheck/server.ts  ->  http://localhost:5195/pr/<n>
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { DELTA_DIR, PORT, REPORTS_DIR } from "./lib/paths.ts";
import { renderPage, renderIndex } from "./lib/page.ts";
import type { Report } from "./lib/report.ts";

const FONTS = `${DELTA_DIR}/public/fonts`;

function load(n: string): Report | null {
  const p = `${REPORTS_DIR}/pr${n}.json`;
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Report) : null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const send = (code: number, type: string, body: string | Buffer) => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  const font = url.pathname.match(/^\/fonts\/([\w.-]+\.woff2)$/);
  if (font) {
    const p = `${FONTS}/${font[1]}`;
    return existsSync(p) ? send(200, "font/woff2", readFileSync(p)) : send(404, "text/plain", "no font");
  }
  const m = url.pathname.match(/^\/pr\/(\d+)(\.json)?\/?$/);
  if (m) {
    const r = load(m[1]);
    if (!r) return send(404, "text/html; charset=utf-8", `<p style="font-family:sans-serif">No report for PR #${m[1]} yet. Run <code>npx tsx prcheck/pr-check.ts --pr ${m[1]}</code>.</p>`);
    return m[2] ? send(200, "application/json", JSON.stringify(r, null, 2)) : send(200, "text/html; charset=utf-8", renderPage(r));
  }
  if (url.pathname === "/" || url.pathname === "/pr" || url.pathname === "/pr/") {
    const reports = existsSync(REPORTS_DIR)
      ? readdirSync(REPORTS_DIR).filter((f) => /^pr\d+\.json$/.test(f)).map((f) => load(f.slice(2, -5))!).filter(Boolean)
      : [];
    return send(200, "text/html; charset=utf-8", renderIndex(reports));
  }
  send(404, "text/plain", "not found");
});
server.listen(PORT, () => console.log(`Bites the Data · PR reports on http://localhost:${PORT}/pr/<n>`));
