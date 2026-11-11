import "dotenv/config";
import express from "express";
import { createServer as createHttpServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DeltaApp } from "./app.ts";

const app = new DeltaApp();
await app.init();
const server = express();
server.use(express.json());

const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  async (req: express.Request, res: express.Response) => {
    try {
      const v = await fn(req, res);
      if (!res.headersSent) res.json(v ?? { ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  };

server.get("/api/state", wrap(async () => app.snapshot()));
server.post("/api/seed", wrap(async () => { await app.seed(); return app.snapshot(); }));
server.post("/api/run", wrap(async (req) => {
  if (app.running) throw new Error("a run is already in progress");
  const mode = req.body?.mode === "llm" ? "llm" : "scripted";
  app.runAgents(mode, Number(req.body?.swarm ?? 0)).catch((e) => console.error("run failed", e));
  return { started: true, mode };
}));
server.get("/api/diff", wrap(async (req) => (await app.diff(String(req.query.from), String(req.query.to))).summary));
server.get("/api/diff/file", wrap(async (req) => app.fileDetail(String(req.query.from), String(req.query.to), String(req.query.path))));
server.get("/api/summaries", wrap(async () => app.summaries()));
server.post("/api/rollback", wrap(async (req) => app.rollbackTo(String(req.body.world))));
server.post("/api/rollforward", wrap(async (req) => app.rollForward(String(req.body.agent))));
server.get("/api/incident", wrap(async (req) => app.incident(String(req.query.agent))));
server.post("/api/fork-run", wrap(async (req) => app.forkAndContinue(String(req.body.world), String(req.body.variant))));
server.post("/api/fork", wrap(async (req) => app.forkFrom(String(req.body.world))));
server.post("/api/history", wrap(async (req) => app.history(String(req.body.agent), String(req.body.query ?? ""))));
server.get("/api/network", wrap(async () => app.network()));
server.get("/api/review", wrap(async () => app.review()));
server.post("/api/bisect-rogues", wrap(async () => app.bisectRogues()));
server.post("/api/bisect", wrap(async (req) => app.bisect(String(req.body.agent), String(req.body.invariant))));

server.get("/api/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write(`event: hello\ndata: {}\n\n`);
  const on = (e: { type: string; data: unknown }) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
  app.events.on("event", on);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    app.events.off("event", on);
  });
});

const httpServer = createHttpServer(server);
const prod = process.env.NODE_ENV === "production";
if (prod && existsSync(resolve("dist/index.html"))) {
  server.use(express.static(resolve("dist")));
  server.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  // HMR rides on the same HTTP server, so no second port can collide with another instance.
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: httpServer } }, appType: "spa" });
  server.use(vite.middlewares);
}

const port = Number(process.env.PORT ?? 5177);
httpServer.listen(port, () => {
  const b = app.backend();
  console.log(`Delta on http://localhost:${port}  ·  backend: ${b.label} (${b.detail})${b.error ? `  ·  ${b.error}` : ""}`);
});
