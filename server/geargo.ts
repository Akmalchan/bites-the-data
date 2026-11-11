// GEARGO catalog scenario: the user's real product catalog (read from their local GEARGO repo at seed time),
// three catalog agents (one rogue), and catalog rules.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Row } from "./diff/types.ts";
import type { AgentDef } from "./agents/scripted.ts";
import { keenableMode, keenableSearch, extractCompanyFacts } from "./keenable.ts";

export const GEARGO_DIR = process.env.DELTA_GEARGO_DIR || "/Users/akmal/IdeaProjects/GEARGO/apps/vendure/src/seed";
const FILES = ["products.csv", "sellers/rax-motors-brake-pads.json", "translations/products.json", "translations/collections.json", "translations/facet-values.json"];

export function geargoAvailable(): boolean {
  return FILES.every((f) => existsSync(join(GEARGO_DIR, f)));
}

export function geargoFiles(): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const f of FILES) out[f] = readFileSync(join(GEARGO_DIR, f));
  out["notes/README.md"] = Buffer.from("# GEARGO catalog\n\nVendure seed data for the GEARGO EV/car-parts marketplace (Tashkent). Prices are whole UZS (no minor unit).\nEvery product needs vehicle fitment unless it is a universal fit.\n");
  return out;
}

const CSV = "products.csv";
const fmt = (n: number) => n.toLocaleString("en-US");
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// PR #106 story: the exact numbers the other session validated.
export const REMOVED = ["tesla-model-y-frunk-organizer", "byd-han-ambient-light-kit"];
export const FITMENT_WIPED = "tesla-model-3-y-aluminum-pedal-set";
export const PRICE_DIV: Record<string, number> = {
  "byd-song-plus-led-headlight-assembly": 29130,
  "xpeng-g6-wireless-carplay-screen": 16850,
  "xpeng-x9-luxury-floor-mat-set": 13060,
  "universal-battery-booster-pack": 10190,
};
export const STOCK_ZEROED = ["li-auto-l8-rear-seat-tablet-holder", "xpeng-g6-cargo-liner", "byd-song-plus-tpe-floor-mat-set"];

const repricer: AgentDef = {
  id: "A",
  name: "Repricer (FX)",
  role: "Reprice imports for the new FX rate",
  goal: "Raise prices of imported products in line with the new USD/UZS rate, keeping whole UZS.",
  steps: [
    {
      name: "Load FX rate",
      thought: "The USD/UZS rate moved; imported items need repricing.",
      run: async (ctx) => {
        await ctx.writeJson("notes/fx.json", { pair: "USD/UZS", from: 12500, to: 12900, source: "CBU" }, "rate 12,500 → 12,900");
      },
    },
    {
      name: "Reprice imported products",
      thought: "Raise imported items 2–5%, rounded to whole 10 UZS.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const n = await ctx.compute("reprice.py --fx 12900", () => {
          let n = 0;
          for (const r of t.rows) {
            if (n >= 40 || hash(String(r.sku)) % 4 === 0) continue;
            const pct = 2.2 + (hash(String(r.slug)) % 32) / 10; // 2.2% .. 5.3%
            r.price = String(Math.round((Number(r.price) * (1 + pct / 100)) / 10) * 10);
            n++;
          }
          return n;
        }, (n) => `${n} prices raised 2.2–5.3%`);
        await ctx.writeCsv(CSV, t.columns, t.rows, `${n} prices changed`);
      },
    },
    {
      name: "Keep sale prices below list",
      thought: "A sale price above the new list price would look broken; cap them.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        let n = 0;
        for (const r of t.rows) {
          const sale = Number(r["product:salePrice"]);
          if (sale && sale >= Number(r.price)) {
            r["product:salePrice"] = String(Math.round(Number(r.price) * 0.95));
            n++;
          }
        }
        await ctx.writeCsv(CSV, t.columns, t.rows, `${n} sale prices capped`);
      },
    },
    {
      name: "Write repricing log",
      thought: "Leave a note for the catalog team.",
      run: async (ctx) => {
        await ctx.writeText("notes/repricing.md", "# Repricing\n\n- USD/UZS 12,500 → 12,900\n- imported items +2.2% to +5.3%\n- prices stay whole UZS\n");
      },
    },
  ],
};

const cleanerSteps = (fuzzy: boolean): AgentDef["steps"] => [
  {
    name: "Scan catalog for duplicates",
    thought: "Look for products that might be listed twice.",
    run: async (ctx) => {
      const t = await ctx.readCsv(CSV);
      await ctx.writeText("notes/cleanup_plan.md", `# Cleanup plan\n\n- ${fmt(t.rows.length)} products\n- merge duplicates\n- normalize fitment, prices and stock\n`);
    },
  },
  {
    name: "Build SKU index",
    thought: "Index products by SKU so merges are cheap.",
    run: async (ctx) => {
      const t = await ctx.readCsv(CSV);
      await ctx.writeJson(".clean/sku_index.json", Object.fromEntries(t.rows.map((r) => [String(r.sku), String(r.slug)])), `${t.rows.length} SKUs`);
    },
  },
  fuzzy
    ? {
        name: "Merge near-duplicate products",
        thought: "Products for the same vehicle with similar names look like duplicates; keep one of each.",
        run: async (ctx) => {
          const t = await ctx.readCsv(CSV);
          const kept = await ctx.compute("merge_fuzzy.py --by vehicle,name", () => t.rows.filter((r) => !REMOVED.includes(String(r.slug))), (k) => `${t.rows.length - k.length} near-duplicates merged`);
          await ctx.writeCsv(CSV, t.columns, kept);
        },
      }
    : {
        name: "Merge exact duplicate SKUs",
        thought: "Only identical SKUs are duplicates; names that merely look alike are different products.",
        run: async (ctx) => {
          const t = await ctx.readCsv(CSV);
          const seen = new Set<string>();
          const kept = await ctx.compute("merge_exact.py --by sku", () => t.rows.filter((r) => (seen.has(String(r.sku)) ? false : (seen.add(String(r.sku)), true))), (k) => `${t.rows.length - k.length} exact duplicates merged`);
          await ctx.writeCsv(CSV, t.columns, kept);
        },
      },
  ...(fuzzy
    ? [
        {
          name: "Normalize fitment fields",
          thought: "Multi-vehicle fitment strings look malformed; clear them so they can be re-imported.",
          run: async (ctx: Parameters<AgentDef["steps"][number]["run"]>[0]) => {
            const t = await ctx.readCsv(CSV);
            for (const r of t.rows) if (r.slug === FITMENT_WIPED) r["product:compatibleVehicleSlugs"] = "";
            await ctx.writeCsv(CSV, t.columns, t.rows, "1 fitment cleared");
          },
        },
        {
          name: "Normalize prices to major units",
          thought: "Some prices look like they are stored in tiyin; divide by 100 to get sum.",
          run: async (ctx: Parameters<AgentDef["steps"][number]["run"]>[0]) => {
            const t = await ctx.readCsv(CSV);
            for (const r of t.rows) if (PRICE_DIV[String(r.slug)]) r.price = String(PRICE_DIV[String(r.slug)]);
            await ctx.writeCsv(CSV, t.columns, t.rows, "4 prices ÷100");
          },
        },
        {
          name: "Sync stock with warehouse feed",
          thought: "Items missing from today's warehouse feed must be out of stock.",
          run: async (ctx: Parameters<AgentDef["steps"][number]["run"]>[0]) => {
            const t = await ctx.readCsv(CSV);
            for (const r of t.rows) if (STOCK_ZEROED.includes(String(r.slug))) r.stockOnHand = "0";
            await ctx.writeCsv(CSV, t.columns, t.rows, "3 items set to 0");
          },
        },
      ]
    : []),
  {
    name: "Write cleanup report",
    thought: "Summarize the cleanup for the catalog team.",
    run: async (ctx) => {
      await ctx.writeText("notes/cleanup_report.md", fuzzy ? "# Cleanup report\n\nMerged duplicates, normalized fitment, prices and stock.\nNo products lost.\n" : "# Cleanup report\n\nMerged exact duplicate SKUs only (none found). Nothing removed.\n");
      await ctx.remove(".clean/sku_index.json");
    },
  },
];

const cleaner: AgentDef = {
  id: "B",
  name: "Catalog cleaner (fuzzy)",
  role: "Dedupe and normalize the catalog",
  goal: "Remove duplicate products and normalize fitment, prices and stock in products.csv.",
  steps: cleanerSteps(true),
};

export const CLEANER_EXACT: AgentDef = { ...cleaner, name: "Catalog cleaner (exact)", role: "Dedupe by exact SKU only", steps: cleanerSteps(false) };

const BRANDS = ["BYD", "Tesla", "XPeng", "Li Auto", "Leapmotor"];
const translator: AgentDef = {
  id: "C",
  name: "Translator (web)",
  role: "Add ru/uz names and brand sites",
  goal: "Add Russian and Uzbek product names to translations/products.json and record official brand sites.",
  steps: [
    {
      name: "Find products missing translations",
      thought: "List products without ru/uz names.",
      run: async (ctx) => {
        const t = await ctx.readCsv(CSV);
        const tr = await ctx.readJson<Record<string, unknown>>("translations/products.json");
        const missing = t.rows.filter((r) => !tr[String(r.slug)]).map((r) => String(r.slug));
        await ctx.writeJson("reports/missing_translations.json", missing, `${missing.length} products`);
      },
    },
    ...[0, 1].map((half) => ({
      name: half ? "Translate the rest (ru, uz)" : "Translate first half (ru, uz)",
      thought: "Write ru and uz names; keep brand and model names in Latin script.",
      run: async (ctx: Parameters<AgentDef["steps"][number]["run"]>[0]) => {
        const t = await ctx.readCsv(CSV);
        const tr = await ctx.readJson<Record<string, unknown>>("translations/products.json");
        const missing = t.rows.filter((r) => !tr[String(r.slug)]);
        const chunk = half ? missing : missing.slice(0, Math.ceil(missing.length / 2));
        for (const r of chunk) tr[String(r.slug)] = { ru: { name: `${r.name} — товар для авто` }, uz: { name: `${r.name} — avtomobil uchun` } };
        await ctx.writeJson("translations/products.json", tr, `+${chunk.length} products`);
      },
    })),
    {
      name: "Look up brand sites (Keenable)",
      thought: "Record each vehicle brand's official site with its source URL.",
      when: () => keenableMode() !== "off",
      run: async (ctx) => {
        const sites: Record<string, { website: string; source: string }> = {};
        for (const b of BRANDS) {
          const q = `${b} electric vehicles official website`;
          try {
            const r = await ctx.tool("web_search", q, () => keenableSearch(q, 5), (v) => `${v.results.length} results${v.cached ? " (cached)" : ""}`);
            const f = extractCompanyFacts(r.results, b.replace(/\s+/g, ""));
            if (f.source) sites[b] = { website: f.website, source: f.source };
          } catch {
            /* skip */
          }
        }
        await ctx.writeJson("sellers/brand_sites.json", sites, `${Object.keys(sites).length} brands`);
      },
    },
  ],
};

export const GEARGO_AGENTS: AgentDef[] = [repricer, cleaner, translator];
export const GEARGO_FORK_VARIANTS = ["Catalog cleaner (exact)", "Repricer (FX)", "Translator (web)"];
export function geargoVariant(name: string): AgentDef | undefined {
  if (name === "Catalog cleaner (exact)") return { ...CLEANER_EXACT, id: "" };
  const d = GEARGO_AGENTS.find((a) => a.name === name);
  return d ? { ...d, id: "" } : undefined;
}

/** Baseline products by SKU, used by the drift / fitment / stock invariants. */
export const baseline = new Map<string, Row>();
export function setBaseline(rows: Row[]) {
  baseline.clear();
  for (const r of rows) baseline.set(String(r.sku), r);
}
