# Bites the Data: demo script

**Dashboard:** `/app` is the classic dense dashboard (worlds sidebar, compare bar, agent cards, typed diffs, review, time-travel query) with a slim icon rail on the far left: **Dashboard**, **Network** (git-style graph, first bad step as a red ring; click a dot to open that step), **Bisect**, **History** and **Swarm** (tiles). Light only. The steps below use the Dashboard page; Bisect is also on the header button.

Table demos start at 9:30 pm: judges walk up to the table, and every project is judged in every track. Keep the app open on **base → B** with the cards visible. Use the **30-second version** when a judge is passing by, and the **2-minute version** when they stop (the full run-through below is the long form).

## GEARGO catalog (default scenario, show this first)

Data: GEARGO's real Vendure seed (products.csv, sellers/rax-motors-brake-pads.json, translations/*.json), read from the GEARGO repo at seed time. **55 real GEARGO products + 1,945 generated in the same format** (2,000 products; prices in whole UZS).

1. **Run agents** (header: "GEARGO catalog", "3 agents"). Repricer (FX) raises 800 prices by 2.2–5.3% (clean). Translator (web) adds ru/uz names for 2,000 products and looks up brand sites with Keenable (clean). Catalog cleaner (fuzzy) is the rogue.
2. **Click the red card** → What went wrong: *"Catalog cleaner (fuzzy) removed 40 products at step 3, wiped fitment on 25 at step 4, divided 60 prices by 100 at step 5, and zeroed stock on 45 at step 6."* Tabs: Removed products 40 · Prices ÷100 60 (e.g. byd-song-plus-led-headlight-assembly 2,800,000 UZS → 29,130 UZS) · Fitment 25 (tesla-model-3-y-aluminum-pedal-set) · Stock 45. These include the real PR #106 cases (tesla-model-y-frunk-organizer and byd-han-ambient-light-kit removed, 4 prices ÷100, 1 fitment, 3 stock).
3. **Copy fix prompt**: task, the 4 broken rules (No product removed · Prices change within ±20% · Fitment set unless universal fit · Stock not zeroed by a catalog agent) with first bad steps found by bisect, examples, the Archil checkpoint to restore (step 2), and "UZS has no minor unit".
4. **Fix it: fork from step 2 with Catalog cleaner (exact)** → real Archil branch, safe steps; Compare: "restored 40 products, restored 60 prices"; toast "0 products lost".
5. Swarm × 8 runs on the **Demo CRM** scenario (switch in the header).

Measured on Archil tonight: Run agents 13.7 s, Fix it 6.5 s, roll back via Archil branch 153 ms, a full rehearsal ~86 exec calls.

## The main path (the one to show)

1. **Run agents.** Three agents fork the same customer database on Archil; every step is a checkpoint.
2. **Click the red card** (Merger (fuzzy) → "See what went wrong →"). The drawer says it in one sentence: *"Merger (fuzzy) deleted 312 customers at step 4 (Fuzzy-merge near-duplicate names) and divided 267 deal amounts by 100 at step 6."* Below: the 312 missing customers (searchable) and the 267 changed deals, plus the agent's own reasoning at the bad step.
3. **Copy fix prompt for your AI agent.** One click copies a ready-to-paste prompt: the task, what went wrong, the broken rules with the first bad step, 10 example lost rows (full list via "Download missing rows"), the exact Archil checkpoint to restore from, and how to verify the fix.
4. **Fix it: fork from step 3 with Merger (exact).** A real Archil branch of the last good checkpoint; a safe merger redoes the job; Compare opens rogue end vs fork: "restored 312 customers, restored 267 deal amounts". Toast: *"0 customers lost · 87 merged."*
5. Close: "Archil saves the world. Bites the Data tells you what happened to it, and takes it back."

## 30-second version

> "Delta is Neon for agent data, on Archil. Three agents cleaned the same customer database, each on its own Archil disk, with zero sandboxes. Git shows this agent's work as minus 4,903 lines of noise. Delta shows it **silently deleted 312 real customers** (points at the B card). Bisect finds the step in 3 checks, time travel tells you when each customer vanished, and one click rolls it back with a real Archil branch."

## 2-minute version

1. **(15 s)** "You asked for Neon, ClickHouse and Databricks for agents. Delta is branch, diff, time travel and roll back for an agent's whole disk. Every agent loop runs in this one process; each agent has its own Archil disk, and each checkpoint is one serverless exec. Zero sandboxes." (Point at the stats strip.)
2. **(25 s)** Click **base → B**, then `customers.csv`. "Git: +4,504 / −4,903. Delta: 87 merged duplicates and **312 lost customers**." Click `crm.sqlite`: "git says binary; Delta shows 267 deal amounts divided by 100."
3. **(20 s)** **Bisect** → **Run bisect**: "Step 4, in 3 checks." Then **Show what step 4 changed**.
4. **(20 s)** Time-travel query, **Carla Roberts**: "Existed through B@3, vanished at B@4."
5. **(20 s) Keenable beat.** On the C card: "Enricher (web) looks companies up on the web with **Keenable**." Click the **Stripe (C, web sources)** example: "Every web-sourced value carries the URL it came from. Delta shows *what* changed and *where it came from*, so you can audit an agent that browses the web." (If Keenable isn't configured, the card says "Keenable: not configured" and this beat is skipped.)
6. **(20 s)** **Roll back B to step 3**: "A real Archil branch in about 400 ms. B is back to 4,913 rows." Close: "**Archil saves the world. Delta tells you what happened to it, and takes it back.**"

---

# Full run-through (2:30)

**Setup.** Run `npm run dev` and open http://localhost:5177/app (the landing page is at http://localhost:5177/). The header should say **Archil · dsk-… · aws-us-west-2**, with the blue "Zero sandboxes" strip under it. If Archil is down, run `DELTA_BACKEND=local npm run dev`; the header then honestly says **Local**. Click **Reset world** once. Choose **3 agents**, dark theme, browser zoom 110%.

---

**0:00 to 0:25. Why this exists.**
> "Tonight's slide asked for Neon, ClickHouse and Databricks for agents. Neon's signature is branching, diff and time travel for Postgres. Delta does that for an agent's whole disk: CSVs, SQLite, JSON, binaries, on Archil.
> Hunter said agents don't need sandboxes, just disks and serverless tool calls. That's how this runs. Every agent loop lives in one host process, and every checkpoint is one serverless exec on the disk. Zero sandboxes." (Point at the stats strip.)
> "And it answers a real critique. Freestyle argued that object-storage agent file systems lack branch, diff, review and revert, so you should use git, and they named Archil as an example. Here's git on agent data."

Click **Run agents**. While it runs (about 10 s):
> "Three data agents fork the same customer database. Every step is a real Archil checkpoint." (Point at the tree's per-step checkpoint times.)

**0:25 to 0:55. git vs Delta.**
Click **base → B**, then `customers.csv`.
> "Git: plus 4,504, minus 4,903 lines. Useless. Delta: 399 rows removed, matched by id. 87 were true duplicates, because their email still exists. **312 have no surviving match. Real customers, gone.** The agent's own report says 'No data loss.'"

Click `crm.sqlite`: "Git says 'Binary files differ.' Delta: the same 312 in the customers table, and 267 deal amounts divided by 100." Click `config.json`: "And it flipped `dedupe.strategy` to fuzzy."

**0:55 to 1:20. Bisect.**
Click **Bisect** (Agent B, "Customers drop only by true duplicates") and **Run bisect**.
> "Which step? Delta binary-searches the checkpoints, reading each one straight from Archil by checkpoint name. **Step 4, in 3 checks.**"

Click **Show what step 4 changed**: "Here's the exact step, the agent's reasoning, and every tool call."

**1:20 to 1:45. Time travel.**
In **Time-travel query** (across B), click the **Carla Roberts** example.
> "When did Carla Roberts vanish? Delta scanned every checkpoint in milliseconds. She **existed through B@3 and vanished at B@4**, the fuzzy merge, and from the database one step later." (Point at the red dot.)

Optional: click the `select count(*) from deals where amount < 1000` example. "0 → 77 at step 6. That's the cents bug."

**1:45 to 2:05. Roll back.**
Re-open **Bisect**, run it, then click **Roll back B to step 3** (or hover B's step 3 in the tree and click **Roll back**).
> "One click. Archil makes a real branch from the step-3 checkpoint in about 200 ms, and B's live world is back. The card now says **87 duplicates merged, 4,913 rows, no customers lost**." **Fork** works the same way: any checkpoint becomes a new Archil branch.

**2:05 to 2:20. Swarm (if time).**
Pick **Swarm × 8**, then **Run agents**.
> "Eight agents from one host process, zero sandboxes. Review: **5 clean, 3 broke invariants**. Find the first bad step for all three in one click." (On the Free plan these share one disk with a folder per agent. With credits, each agent gets its own disk.)

**2:20 to 2:30. Close.**
> "Branch, diff, review, revert and time-travel, for agent data on Archil. **Archil saves the world. Delta tells you what happened to it, and takes it back.**"

---

## Backup answers

- **Why not git?** Git sees text lines in one repo, and only what the agent commits. It shows a re-sorted CSV as a full rewrite and SQLite as "binary differs". Delta diffs any two checkpoints of the whole disk with no agent cooperation, and works at row level.
- **How is it built on Archil?** One disk. Agent file writes use the S3 object API, which costs no exec calls. Each checkpoint is one serverless exec that hashes the world and runs `archil checkpoints create`. Reads at any checkpoint use S3 `GetObject` with `versionId=<checkpoint>`. Roll back and fork use `disk.createBranch({ fromCheckpoint })`. A 3-agent run with 21 checkpoints is about 28 exec calls (about $0.0014) and zero sandbox compute.
- **Aligned with Archil's guides.** Archil documents SQLite on disks (docs.archil.com/compute/sqlite). The ClickHouse guide gives heavy queries their own copy of the database with a branch. Delta is the missing review layer for exactly those branches: what changed, when, and how to undo it.
- **Lost vs merged?** For each removed row, Delta looks for a surviving row with the same natural key (it prefers `email`).
- **Is the agent real?** Scripted mode is deterministic for the demo. **Claude agents (claude-opus-5-5)** runs a real tool loop in the same worlds; that needs `ANTHROPIC_API_KEY`.
- **Scale?** Hashing is streamed, and files over 64 MB are compared by size and hash. A 200k-row CSV diffs in under a second. A 50-agent swarm runs and reviews locally in seconds, and bisecting all 24 failing (agent, invariant) pairs took about 1 s.
