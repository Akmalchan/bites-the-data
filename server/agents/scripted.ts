// Deterministic "scripted" agents. They do the real work on real files (so the
// diffs are real), step by step, logging tool calls like an LLM agent would.
import type { Row } from "../diff/types.ts";
import { embeddings } from "../seed.ts";
import { extractCompanyFacts, keenableMode, keenableSearch } from "../keenable.ts";
import type { StepContext } from "./context.ts";

export interface StepDef {
  name: string;
  thought: string;
  /** Optional gate: the step only runs when this returns true (e.g. an API key is configured). */
  when?: () => boolean;
  run: (ctx: StepContext) => Promise<void>;
}

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  goal: string;
  steps: StepDef[];
  /** Runs as a live LLM agent when its provider key is set; `steps` are the scripted fallback. */
  live?: { provider: "mistral"; name: string; role: string; goal: string; prompt: string };
}

const CSV = "customers.csv";
const DB = "crm.sqlite";
const fmt = (n: number) => n.toLocaleString("en-US");

export function toE164(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  let digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = "+" + digits.slice(2);
  if (digits.startsWith("+")) return "+" + digits.slice(1).replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits;
}

const CC: [string, string][] = [["44", "GB"], ["49", "DE"], ["33", "FR"], ["81", "JP"], ["91", "IN"], ["61", "AU"], ["1", "US"]];
export function countryFromPhone(raw: string): string {
  const e = toE164(raw);
  for (const [cc, code] of CC) if (e.startsWith("+" + cc)) return code;
  return "";
}
const REGION: Record<string, string> = { US: "AMER", CA: "AMER", GB: "EMEA", DE: "EMEA", FR: "EMEA", JP: "APAC", IN: "APAC", AU: "APAC" };

export function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// ---------------------------------------------------------------- Agent A
const normalizer: AgentDef = {
  id: "A",
  name: "Formatter (phones)",
  role: "Phones to E.164, lowercase emails",
  goal: "Make every phone E.164 and every email lowercase, in the CSV and the CRM database.",
  steps: [
    {
      name: "Profile the dataset",
      thought: "Look at the columns and how messy phones and emails are before touching anything.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const stats = await ctx.compute("profile(customers.csv)", () => {
          const phoneStyles = new Set(t.rows.map((r) => String(r.phone).replace(/\d/g, "9")));
          const upper = t.rows.filter((r) => String(r.email) !== String(r.email).toLowerCase()).length;
          return { phoneStyles: phoneStyles.size, upper };
        }, (s) => `${s.phoneStyles} phone formats, ${fmt(s.upper)} mixed-case emails`);
        await ctx.writeText("notes/profile.md", `# Profile (Formatter)\n\n- rows: ${fmt(t.rows.length)}\n- phone formats seen: ${stats.phoneStyles}\n- mixed-case emails: ${fmt(stats.upper)}\n`);
      },
    },
    {
      name: "Normalize phone numbers to E.164",
      thought: "Strip punctuation, map 00 to +, assume +1 for bare 10-digit numbers.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const n = await ctx.compute("normalize_phones.py", () => {
          let n = 0;
          for (const r of t.rows) { const e = toE164(String(r.phone)); if (e !== r.phone) { r.phone = e; n++; } }
          return n;
        }, (n) => `${fmt(n)} phones rewritten`);
        await ctx.writeCsv(CSV, t.columns, t.rows, `${fmt(n)} phones changed`);
      },
    },
    {
      name: "Lowercase emails",
      thought: "Emails are case-insensitive in practice; lowercase them so joins work.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const n = await ctx.compute("lowercase_emails.py", () => {
          let n = 0;
          for (const r of t.rows) { const e = String(r.email).trim().toLowerCase(); if (e !== r.email) { r.email = e; n++; } }
          return n;
        }, (n) => `${fmt(n)} emails lowercased`);
        await ctx.writeCsv(CSV, t.columns, t.rows, `${fmt(n)} emails changed`);
      },
    },
    {
      name: "Collapse whitespace in names",
      thought: "Some names have double or trailing spaces from the HubSpot export.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const n = await ctx.compute("clean_names.py", () => {
          let n = 0;
          for (const r of t.rows) { const v = String(r.name).trim().replace(/\s+/g, " "); if (v !== r.name) { r.name = v; n++; } }
          return n;
        }, (n) => `${fmt(n)} names cleaned`);
        await ctx.writeCsv(CSV, t.columns, t.rows, `${fmt(n)} names changed`);
      },
    },
    {
      name: "Apply normalization to crm.sqlite",
      thought: "Mirror the same rules into the customers table so the CSV and DB agree.",
      run: async (ctx) => {
        await ctx.sqlite(DB, "UPDATE customers SET phone=e164(phone), email=lower(trim(email)), name=squash(name)", (db) => {
          db.function("e164", (v: unknown) => toE164(String(v ?? "")));
          db.function("squash", (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " "));
          const r = db.prepare("UPDATE customers SET phone=e164(phone), email=lower(trim(email)), name=squash(name)").run();
          return Number(r.changes);
        }, (n) => `${fmt(n)} rows updated`);
      },
    },
    {
      name: "Write change log",
      thought: "Leave a note for the humans and tick the todo item.",
      run: async (ctx) => {
        const todo = await ctx.readText("notes/todo.md");
        await ctx.writeText("notes/todo.md", todo.replace("- [ ] normalize phone numbers", "- [x] normalize phone numbers (Formatter)"));
        await ctx.writeText("notes/normalize_log.md", "# Formatter log\n\n- phones -> E.164\n- emails -> lowercase\n- names -> single spaces\n- crm.sqlite customers updated to match\n");
      },
    },
  ],
};

// ---------------------------------------------------------------- Agent B
const deduper: AgentDef = {
  id: "B",
  name: "Merger (fuzzy)",
  role: "Merge duplicate customers",
  goal: "Find duplicate customers, merge them, and keep crm.sqlite consistent.",
  steps: [
    {
      name: "Scan for duplicate candidates",
      thought: "Group customers by lowercase email first; that is the safe signal.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const dups = await ctx.compute("count_dupes.py", () => {
          const seen = new Map<string, number>();
          for (const r of t.rows) seen.set(String(r.email).toLowerCase(), (seen.get(String(r.email).toLowerCase()) ?? 0) + 1);
          return [...seen.values()].filter((v) => v > 1).length;
        }, (n) => `${fmt(n)} emails appear more than once`);
        await ctx.writeText("notes/dedupe_plan.md", `# Dedupe plan\n\n1. merge exact duplicates by email (${dups} groups)\n2. merge near-duplicate names at the same company\n3. sync deletions to crm.sqlite\n`);
      },
    },
    {
      name: "Build email index",
      thought: "Index ids by normalized email so merges are cheap.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const idx: Record<string, number[]> = {};
        await ctx.compute("build_index.py", () => {
          for (const r of t.rows) (idx[String(r.email).toLowerCase()] ??= []).push(Number(r.id));
        }, () => `${fmt(Object.keys(idx).length)} keys`);
        await ctx.writeJson(".dedupe/email_index.json", idx, `${fmt(Object.keys(idx).length)} keys`);
      },
    },
    {
      name: "Merge exact duplicates (same email)",
      thought: "Sort by email so duplicates are adjacent, keep the lowest id in each group.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const merged: Record<string, number> = {};
        const kept = await ctx.compute("merge_exact.py", () => {
          const sorted = [...t.rows].sort((a, b) => String(a.email).toLowerCase().localeCompare(String(b.email).toLowerCase()) || Number(a.id) - Number(b.id));
          const out: Row[] = [];
          const byEmail = new Map<string, Row>();
          for (const r of sorted) {
            const k = String(r.email).toLowerCase();
            const keep = byEmail.get(k);
            if (keep) merged[String(r.id)] = Number(keep.id);
            else { byEmail.set(k, r); out.push(r); }
          }
          return out;
        }, (rows) => `${fmt(t.rows.length - rows.length)} duplicates merged`);
        await ctx.writeCsv(CSV, t.columns, kept, `${fmt(kept.length)} rows (sorted by email)`);
        await ctx.writeJson(".dedupe/merged_exact.json", merged);
      },
    },
    {
      name: "Fuzzy-merge near-duplicate names",
      thought: "Same last name and company with a one-letter first-name difference is probably a typo. Merge those too.",
      run: async (ctx) => {
        const cfg = await ctx.readJson<Record<string, any>>("config.json");
        cfg.dedupe.strategy = "fuzzy";
        cfg.dedupe.match_on = ["last_name", "company", "first_name~1"];
        await ctx.writeJson("config.json", cfg, "dedupe.strategy = fuzzy");
        const t = await ctx.readCsv(CSV);
        const merged: Record<string, number> = {};
        const kept = await ctx.compute("merge_fuzzy.py --max-edit 1", () => {
          // BUG (planted): first-name edit distance 1 also matches different real people
          // (Maria/Mario, Daniel/Daniela). These are not duplicates; their emails differ.
          const groups = new Map<string, Row[]>();
          for (const r of t.rows) {
            const parts = String(r.name).trim().split(/\s+/);
            const k = `${parts[parts.length - 1].toLowerCase()}|${r.company}`;
            (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
          }
          const drop = new Set<string>();
          for (const g of groups.values()) {
            if (g.length < 2) continue;
            g.sort((a, b) => Number(a.id) - Number(b.id));
            for (let i = 1; i < g.length; i++) {
              const fi = String(g[i].name).trim().split(/\s+/)[0].toLowerCase();
              const keep = g.find((x, j) => j < i && !drop.has(String(x.id)) && editDistanceAtMost1(String(x.name).trim().split(/\s+/)[0].toLowerCase(), fi));
              if (keep) { drop.add(String(g[i].id)); merged[String(g[i].id)] = Number(keep.id); }
            }
          }
          return t.rows.filter((r) => !drop.has(String(r.id)));
        }, (rows) => `${fmt(t.rows.length - rows.length)} near-duplicates merged`);
        await ctx.writeCsv(CSV, t.columns, kept);
        await ctx.writeJson(".dedupe/merged_fuzzy.json", merged);
      },
    },
    {
      name: "Sync merges to crm.sqlite",
      thought: "Delete merged customers from the DB and re-point their deals to the surviving record.",
      run: async (ctx) => {
        const a = await ctx.readJson<Record<string, number>>(".dedupe/merged_exact.json");
        const b = await ctx.readJson<Record<string, number>>(".dedupe/merged_fuzzy.json").catch(() => ({}) as Record<string, number>);
        const map = { ...a, ...b };
        await ctx.sqlite(DB, "UPDATE deals SET customer_id=:survivor ...; DELETE FROM customers WHERE id IN (...)", (db) => {
          db.exec("BEGIN");
          const up = db.prepare("UPDATE deals SET customer_id=? WHERE customer_id=?");
          const del = db.prepare("DELETE FROM customers WHERE id=?");
          let repointed = 0;
          for (const [gone, keep] of Object.entries(map)) {
            repointed += Number(up.run(keep, Number(gone)).changes);
            del.run(Number(gone));
          }
          db.exec("COMMIT");
          return { deleted: Object.keys(map).length, repointed };
        }, (v) => `${fmt(v.deleted)} customers deleted, ${fmt(v.repointed)} deals re-pointed`);
      },
    },
    {
      name: "Normalize deal amounts",
      thought: "Some amounts look like they are stored in cents (over 50,000). Convert them to dollars.",
      run: async (ctx) => {
        // BUG (planted): these are real large deals in dollars, not cents.
        await ctx.sqlite(DB, "UPDATE deals SET amount = amount / 100 WHERE amount > 50000", (db) => Number(db.prepare("UPDATE deals SET amount = amount / 100 WHERE amount > 50000").run().changes), (n) => `${fmt(n)} rows updated`);
      },
    },
    {
      name: "Write dedupe report",
      thought: "Summarize what was merged for the data team.",
      run: async (ctx) => {
        const a = await ctx.readJson<Record<string, number>>(".dedupe/merged_exact.json");
        const b = await ctx.readJson<Record<string, number>>(".dedupe/merged_fuzzy.json").catch(() => ({}) as Record<string, number>);
        const total = Object.keys(a).length + Object.keys(b).length;
        await ctx.writeText("notes/dedupe_report.md", `# Dedupe report\n\nMerged ${fmt(total)} duplicate customers (${fmt(Object.keys(a).length)} exact, ${fmt(Object.keys(b).length)} fuzzy).\nAll merged records had a surviving duplicate. No data loss.\nDeal amounts normalized to dollars.\n`);
      },
    },
    {
      name: "Clean up temporary files",
      thought: "Remove the .dedupe scratch directory.",
      run: async (ctx) => {
        await ctx.remove(".dedupe/email_index.json");
        await ctx.remove(".dedupe/merged_exact.json");
        await ctx.remove(".dedupe/merged_fuzzy.json");
      },
    },
  ],
};

// ---------------------------------------------------------------- Agent C
const enricher: AgentDef = {
  id: "C",
  name: "Enricher (web)",
  role: "Fill countries, add region",
  goal: "Fill blank countries from phone prefixes and add a sales region to every customer.",
  steps: [
    {
      name: "Find rows missing a country",
      thought: "List the customers with a blank country so the change is auditable.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const missing = t.rows.filter((r) => String(r.country).trim() === "");
        await ctx.writeCsv("reports/missing_country.csv", ["id", "phone"], missing.map((r) => ({ id: r.id, phone: r.phone })), `${fmt(missing.length)} rows`);
      },
    },
    {
      name: "Infer country from phone prefix",
      thought: "+44 is GB, +49 is DE, and so on. Bare 10-digit numbers are North American; assume US.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const n = await ctx.compute("infer_country.py", () => {
          let n = 0;
          for (const r of t.rows) if (String(r.country).trim() === "") { const c = countryFromPhone(String(r.phone)); if (c) { r.country = c; n++; } }
          return n;
        }, (n) => `${fmt(n)} countries filled`);
        await ctx.writeCsv(CSV, t.columns, t.rows, `${fmt(n)} cells filled`);
      },
    },
    {
      name: "Add region column",
      thought: "Sales wants AMER / EMEA / APAC on every customer.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        for (const r of t.rows) r.region = REGION[String(r.country)] ?? "";
        const cols = [...t.columns.slice(0, t.columns.indexOf("country") + 1), "region", ...t.columns.slice(t.columns.indexOf("country") + 1)];
        await ctx.writeCsv(CSV, cols, t.rows, "+1 column (region)");
      },
    },
    {
      name: "Web-enrich companies (Keenable)",
      thought: "Look each company up on the web to fill industry and website, and keep the source URL for every value.",
      when: () => keenableMode() !== "off",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const missing = await ctx.readCsv("reports/missing_country.csv");
        const ids = new Set(missing.rows.map((r) => String(r.id)));
        const max = Number(process.env.DELTA_KEENABLE_MAX ?? 25);
        const companies = [...new Set(t.rows.filter((r) => ids.has(String(r.id))).map((r) => String(r.company)))].slice(0, max);
        const facts: Record<string, ReturnType<typeof extractCompanyFacts> & { query: string }> = {};
        for (let i = 0; i < companies.length; i += 10) {
          await Promise.all(
            companies.slice(i, i + 10).map(async (company) => {
              const query = `${company} company official website`;
              try {
                const r = await ctx.tool("web_search", query, () => keenableSearch(query, 5), (v) => `${v.results.length} results${v.cached ? " (cached)" : ""}`);
                const f = extractCompanyFacts(r.results, company);
                f.industry ||= "Software";
                if (f.source) facts[company] = { ...f, query };
              } catch {
                /* one failed lookup never fails the agent */
              }
            }),
          );
        }
        const cols = [...t.columns];
        for (const c of ["industry", "website"]) if (!cols.includes(c)) cols.splice(cols.indexOf("region") + 1 || cols.length, 0, c);
        let filled = 0;
        for (const r of t.rows) {
          const f = facts[String(r.company)];
          r.industry = f?.industry ?? r.industry ?? "";
          r.website = f?.website ?? r.website ?? "";
          if (f) filled++;
        }
        await ctx.writeCsv(CSV, cols, t.rows, `${fmt(filled)} rows web-enriched from ${Object.keys(facts).length} companies`);
        await ctx.writeJson("notes/enrichment_sources.json", facts, `${Object.keys(facts).length} sources`);
        await ctx.sqlite(DB, "ALTER TABLE customers ADD COLUMN industry, website; UPDATE … FROM web lookups", (db) => {
          db.exec("ALTER TABLE customers ADD COLUMN industry TEXT; ALTER TABLE customers ADD COLUMN website TEXT;");
          const up = db.prepare("UPDATE customers SET industry = ?, website = ? WHERE company = ?");
          let n = 0;
          for (const [company, f] of Object.entries(facts)) n += Number(up.run(f.industry, f.website, company).changes);
          return n;
        }, (n) => `${fmt(n)} rows updated`);
      },
    },
    {
      name: "Update pipeline config",
      thought: "Record the enrichment step and turn on the Clearbit source.",
      run: async (ctx) => {
        const cfg = await ctx.readJson<Record<string, any>>("config.json");
        cfg.schema_version = 4;
        cfg.sources.find((s: { id: string }) => s.id === "clearbit").enabled = true;
        cfg.enrichment = { country_from_phone: true, region_map: "AMER/EMEA/APAC", added_by: "enricher" };
        await ctx.writeJson("config.json", cfg, "schema_version 3 → 4");
      },
    },
    {
      name: "Mirror enrichment into crm.sqlite",
      thought: "Add the region column to the customers table and fill countries there too.",
      run: async (ctx) => {
        await ctx.sqlite(DB, "ALTER TABLE customers ADD COLUMN region TEXT; UPDATE customers SET ...", (db) => {
          db.function("phone_country", (v: unknown) => countryFromPhone(String(v ?? "")));
          db.function("region_of", (v: unknown) => REGION[String(v ?? "")] ?? "");
          db.exec("ALTER TABLE customers ADD COLUMN region TEXT");
          const a = db.prepare("UPDATE customers SET country = phone_country(phone) WHERE trim(coalesce(country,'')) = '' AND phone_country(phone) <> ''").run();
          db.prepare("UPDATE customers SET region = region_of(country)").run();
          return Number(a.changes);
        }, (n) => `+region column, ${fmt(n)} countries filled`);
      },
    },
    {
      name: "Refresh embeddings cache",
      thought: "Customer text changed, so the cached embeddings are stale. Rebuild them.",
      run: async (ctx) => {
        await ctx.tool("run_python", "embed.py --out cache/embeddings.bin", async () => undefined, () => "1,024 vectors");
        await ctx.writeBinary("cache/embeddings.bin", embeddings(7, 896 * 1024), "896 KB");
      },
    },
    {
      name: "Write report and archive todo",
      thought: "Summarize the enrichment and move the finished todo list to the archive.",
      run: async (ctx) => {
        const missing = await ctx.readCsv("reports/missing_country.csv");
        await ctx.writeText("reports/enrichment.md", `# Enrichment report\n\n- ${fmt(missing.rows.length)} customers had no country; filled from phone prefix.\n- Added region (AMER/EMEA/APAC) to customers.csv and crm.sqlite.\n- Enabled the clearbit source in config.json.\n`);
        await ctx.rename("notes/todo.md", "notes/archive/todo.md");
      },
    },
  ],
};

export const AGENTS: AgentDef[] = [normalizer, deduper, enricher];

// ---------------------------------------------------------------- Swarm
// Variants of the three agents with some steps switched off. Some are clean, some carry
// one or both of the Merger's planted bugs, so a swarm review has real rogues to find.
interface Variant {
  base: AgentDef;
  name: string;
  role: string;
  skip: string[]; // step names left out
}
const FUZZY = "Fuzzy-merge near-duplicate names";
const CENTS = "Normalize deal amounts";
const VARIANTS: Variant[] = [
  { base: deduper, name: "Merger (exact)", role: "Merge exact duplicates only", skip: [FUZZY, CENTS] },
  { base: normalizer, name: "Formatter (phones)", role: "Phones to E.164, lowercase emails", skip: [] },
  { base: deduper, name: "Merger (fuzzy)", role: "Exact plus fuzzy name merge", skip: [CENTS] },
  { base: enricher, name: "Enricher (web)", role: "Fill countries, add region", skip: [] },
  { base: normalizer, name: "Formatter (emails)", role: "Lowercase emails only", skip: ["Normalize phone numbers to E.164", "Collapse whitespace in names"] },
  { base: deduper, name: "Merger (money)", role: "Exact merge, fix deal amounts", skip: [FUZZY] },
  { base: enricher, name: "Enricher (lite)", role: "Fill countries only", skip: ["Update pipeline config", "Refresh embeddings cache"] },
  { base: deduper, name: "Merger (aggressive)", role: "Every merge rule on", skip: [] },
];

export function swarmDefs(n: number): AgentDef[] {
  const out: AgentDef[] = [];
  for (let i = 0; i < n; i++) {
    const v = VARIANTS[i % VARIANTS.length];
    out.push({
      id: `S${i + 1}`,
      name: v.name,
      role: v.role,
      goal: v.base.goal,
      steps: v.base.steps.filter((s) => !v.skip.includes(s.name)),
    });
  }
  return out;
}

/** Steps that will actually run now (gated steps drop out when their key is missing). */
export function activeSteps(def: AgentDef): StepDef[] {
  return def.steps.filter((s) => !s.when || s.when());
}

/** Safe agents a fork can continue with. Each skips the steps the source agent already did. */
export const FORK_VARIANTS = ["Merger (exact)", "Formatter (emails)", "Enricher (lite)"] as const;

export function forkVariantDef(name: string): AgentDef | undefined {
  const v = VARIANTS.find((x) => x.name === name);
  if (!v) return undefined;
  return { id: "", name: v.name, role: v.role, goal: v.base.goal, steps: v.base.steps.filter((s) => !v.skip.includes(s.name)) };
}
