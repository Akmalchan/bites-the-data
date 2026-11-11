# Bites the Data: submission text

## Name
Bites the Data

## One-liner
Track Changes for AI agents' data: see exactly what an agent changed, find the step that broke it, and roll it back. Built on Archil checkpoints.

## Short description (about 100 words)
Archil can checkpoint and branch an agent's whole disk in milliseconds, but nothing shows what changed between two checkpoints. Bites the Data does. Agents run with zero sandboxes: every tool call is one serverless exec on the agent's own Archil disk, followed by a checkpoint. Bites the Data then reads any checkpoint and produces typed diffs: CSV rows and cells, SQLite tables, JSON paths. Where git reports "+4,504 −4,903 lines" or "Binary files differ", we report "312 customers deleted, 267 deal amounts divided by 100". Bisect finds the first bad step, a time-travel query finds when a value vanished, and one click rolls the agent back using an Archil branch.

## What Archil asked for, and how we answer it
- Data infrastructure for agents ("Neon for agents"): branch, diff, time travel and roll back for an agent's whole disk.
- Large agent swarms: run 8 to 50 agents from one host process; the review shows which ones broke a rule and bisects each.
- Multi-tenant agent loops: each agent gets its own Archil disk; no sandboxes are used.

## How it uses Archil
- One disk per agent, opened or created in parallel.
- `archil checkpoints create` after every agent step, run inside `disk.exec`.
- Reads files at any checkpoint through the S3 API with `versionId`.
- Roll back and fork through `disk.createBranch({ fromCheckpoint })`.
- A full 3-agent run costs about 28 exec calls and no sandbox compute.

## How it uses Keenable
The Enricher (web) agent looks up 25 real companies with Keenable web search and writes industry and website into the data, with the source URL for each value. The time-travel query shows where any value came from, for example "website empty → stripe.com, source https://stripe.com/products".

## Built with
Archil (disks, exec, checkpoints, branches), Keenable (web search), TypeScript, Node, React, Vite, SQLite.

## Honest notes
- Agents are scripted for a reliable demo. A Claude-driven agent mode is built in but was not run tonight.
- The customer data is synthetic. Company names in the enrichment set are real; all people and emails are fake.
- Built at the hackathon on Nov 10, starting in the afternoon before check-in.

## Team
Akmal Shovkatov
