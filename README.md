# Bites the Data

*(repo name: delta)*

**Neon for agent data, on Archil.** Branch, diff, time-travel and roll back an agent's whole disk: CSVs, SQLite, JSON and binaries. Zero sandboxes: every agent loop runs in one host process, and disk work goes straight to Archil (object API plus one serverless exec per checkpoint).

Archil can checkpoint and fork an agent's entire disk in milliseconds. Nothing shows you *what changed* between two saved worlds. Archil's docs list no diff or compare for checkpoints. Delta compares any two checkpoints or forks and shows exactly what changed. That includes what git shows badly:

| File | What git shows | What Delta shows |
|---|---|---|
| `customers.csv` (re-sorted, 399 rows removed) | `+4,504 −4,903 lines` | `−399 rows: 312 lost (no surviving email), 87 merged duplicates` |
| `crm.sqlite` | `Binary files differ` | `customers: −399 rows; deals: 267 amount values changed ÷100` |
| `config.json` | line noise | `dedupe.strategy: exact → fuzzy` |
| `cache/embeddings.bin` | `Binary files differ` | `768 KB → 896 KB`, both sha256 hashes |
| `notes/todo.md → notes/archive/todo.md` | delete + add | renamed (identical content) |

The demo uses a **data agent**, not a coding agent. Archil's customers (Clay, Gamma) run data and document agents, and git is weakest on data.

## What's in the box

- **Diff engine** (`server/diff/`): manifest compare by sha256, rename detection by hash, then a typed diff per file:
  - CSV: row-level diff keyed by an auto-detected id column (falls back to row hashes), per-cell before → after, filled and cleared cells, added and dropped columns. Re-sorting a file counts as zero changes.
  - **Lost vs merged**: each removed row is checked for a surviving twin on a natural key (for example `email`). This is how Delta tells "87 true duplicates merged" apart from "312 real customers deleted".
  - **Magnitude shifts**: numeric cells that change by 10x or more (cents/dollars bugs, unit mix-ups) are flagged.
  - SQLite: per-table row diff by declared primary key, or by rowid; schema changes; "bytes changed but every row identical" (VACUUM).
  - JSON: structural path diff (`sources[id=clearbit].enabled: false → true`), with arrays of objects matched by `id`.
  - Text: unified diff. Binary and files over 64 MB: size and sha256 only (streamed hashing).
  - "What git shows" runs the real `git diff --no-index --numstat` on the two versions, so the comparison is honest.
- **Two backends** behind one `WorldStore` interface (`server/store/`):
  - `LocalStore` (default, offline): a world is a directory. Fork and checkpoint are APFS copy-on-write clones (`cp -c -R`, about 3 ms), with a plain-copy fallback.
  - `ArchilStore` (when `ARCHIL_API_KEY` is set): all worlds live on **one** Archil disk. Each checkpoint is **one** serverless exec that hashes the world and runs `archil checkpoints create`, making a real, immutable Archil checkpoint. Reads at a checkpoint use S3 `GetObject` with `versionId=<checkpoint>`, hash-verified and cached by content. Writes go through the S3 object API, which costs no exec calls. A full run of 3 agents and 21 checkpoints costs **about 28 exec calls and 0 sandbox compute**.
- **Agents** (`server/agents/`): three agents fork the seeded base world, run 6 to 8 steps each, and checkpoint after every step.
  - **A Formatter (phones)**: phones to E.164, emails lowercased, names cleaned, mirrored into the DB. (Good.)
  - **B Merger (fuzzy)**: merges exact duplicates (correct), then a planted bug. Step 4's fuzzy merge deletes 312 real customers, and step 6 divides 267 large deal amounts by 100 ("cents"). Its own report says "No data loss."
  - **C Enricher (web)**: fills 418 missing countries, adds a `region` column, edits `config.json`, refreshes a binary cache, and renames a note.
  - Modes: **Scripted** (deterministic, the default) or **Claude** (`claude-opus-5-5` tool loop with `read_file` / `write_file` / `run_bash`, restricted to the agent's world), enabled when `ANTHROPIC_API_KEY` is set.
- **Roll back / fork from any checkpoint**: hover a step in the tree, or use the bisect verdict. On Archil this is a real `disk.createBranch({ fromCheckpoint })` (about 200 ms round trip); the agent's live folder is then restored through the object API. Locally it's an APFS clone. History stays, because checkpoints are immutable. This completes the "branch, diff, review, revert" list.
- **Time-travel query** (`server/history.ts`): follow a value (id, email, name) or a SQL scalar across every checkpoint of an agent. Example: "customers.csv id 63 (Carla Roberts) existed from base through B@3, vanished at B@4 (Fuzzy-merge near-duplicate names)". Parsed tables are cached by content hash; repeat queries take tens of ms.
- **One disk per agent** (Archil): each agent gets its own disk (slot disks `delta-agent-1..8`, reused across runs, ids cached in `data/archil-state.json`, opened or created in parallel). The fork from the base world is one serverless exec with both disks mounted. If the plan's disk limit is hit, the remaining agents share the main disk with a folder each, and the stats strip says so. Turn it off with `DELTA_DISK_PER_AGENT=0`. If the API key changes workspace, Delta notices that the cached disk is invisible, backs up the old state files, and starts fresh.
- **Keenable web enrichment** (`server/keenable.ts`): with `KEENABLE_API_KEY` set (or `KEENABLE_KEYLESS=1`), Enricher (web) gets an extra step that looks up up to 25 companies on the web, fills `industry` and `website` in the CSV and the DB, and records the source URL for each company in `notes/enrichment_sources.json`. Lookups are cached on disk, so re-runs are free. The time-travel query shows that source URL next to every value the step wrote. Without a key the step is skipped, and the card says "Keenable: not configured".
- **Swarm and review**: fan out 8, 20 or 50 scripted agent variants (Merger (exact / fuzzy / money / aggressive), Formatter (phones / emails), Enricher (web / lite)) from one base world, all in one Node process with bounded concurrency. Review checks every invariant at every head ("5 clean · 3 broke invariants"), and one click bisects every rogue (agent, invariant) pair. On the Free plan the swarm shares one disk with a folder per agent; a disk per agent is the natural next step once the disk cap is lifted.
- **Archil stats strip**: checkpoints, branches, exec calls, checkpoint reads and bytes, object writes, and estimated cost (exec at $0.05 per 1k), all counted from real calls this session.
- **Bisect** (`server/app.ts`): binary search over an agent's checkpoints for the first step that breaks an invariant. It checks the endpoints first, then halves the range. The invariant language is tiny: `rows(customers.csv) >= 4913`, `sql(crm.sqlite, "select round(sum(amount)) from deals") >= 72501426`, `exists(path)`, `size(path)`, and `and`.

## Run it

Needs Node 22.19 or newer (Node 25 tested). `node:sqlite` is built in, so there are no native dependencies.

```bash
npm install
cp .env.example .env        # optional: add ARCHIL_API_KEY and/or ANTHROPIC_API_KEY
npm run dev                 # landing: http://localhost:5177/  ·  app: http://localhost:5177/app
```

Click **Run agents**, then **base → B**, then **Bisect**.

| Command | What it does |
|---|---|
| `npm run dev` | Server + UI on :5177 (Vite middleware). Uses Archil if `ARCHIL_API_KEY` is set; force local with `DELTA_BACKEND=local npm run dev` |
| `npm test` | vitest: CSV keyed diff, lost-vs-merged, SQLite diff (PK + rowid + VACUUM), JSON paths, renames, 24 MB binary, 200k-row CSV, invariants |
| `npm run build` | Typecheck + production bundle (`npm start` serves it) |
| `npm run seed` | Rebuild the base world from the command line |
| `npm run smoke:archil` | Archil capability check with a PASS/FAIL table. `-- --no-sandbox` skips the sandbox fork test (saves free-plan compute) |
| `npm run shots -- --theme dark` | Headless Chrome walk through the demo path; screenshots go to `shots/` |

Env: `ARCHIL_API_KEY`, `ARCHIL_REGION` (default `aws-us-west-2`), `ARCHIL_DISK_ID` (optional, reuse a disk), `ANTHROPIC_API_KEY`, `PORT`, `DELTA_PACE_MS` (scripted-agent pacing, default 350).

## Archil alignment

Archil's docs run SQLite directly on disks (docs.archil.com/compute/sqlite), and the ClickHouse guide gives heavy queries their own copy of the database with a branch. Delta is the review layer for those branches: what changed (row level), when it changed (time-travel query, bisect), and how to undo it (roll back to a checkpoint branch).

## Archil notes (free plan)

- One disk (`delta-worlds`); its id is cached in `data/archil-state.json`. The free plan allows 5 disks.
- Checkpoints can't be deleted. Names are prefixed with the run id (`d-<run>-B-s4`), so re-runs never collide.
- A fresh checkpoint returns `503 SlowDown` ("not readable yet") for a few seconds. Delta retries, and it serves its own writes from a content-addressed cache, so the UI doesn't wait.
- Plain `disk.exec` mounts in shared mode, where some paths are read-only. Delta uses a conditional mount for writes (`cp -a`, `run_bash`) and plain exec for checkpoints, which need the `/mnt/archil` mountpoint.
- Sandboxes and `sandbox.fork()` work (smoke-tested: fork about 3.4 s including boot), but Delta doesn't need them. The exec path uses no sandbox compute.

## Layout

```
server/diff/      engine.ts (world diff), table.ts (keyed rows), csv, sqlite, json, text, gitview
server/store/     types.ts (WorldStore), local.ts, archil.ts
server/agents/    scripted.ts (A/B/C), llm.ts (Claude tool loop), context.ts (tool-call logging)
server/app.ts     world tree, runs, diff cache, bisect      server/index.ts  HTTP + SSE
src/              React UI (App, FileDetail, Bisect)
scripts/          seed.ts, archil-smoke.ts, shots.ts
tests/            diff.test.ts
```
