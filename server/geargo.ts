// GEARGO catalog scenario: the user's real product catalog (read from their local GEARGO repo at seed time),
// three catalog agents (one rogue), and catalog rules.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import type { Row } from "./diff/types.ts";
import { rng } from "./seed.ts";
import type { AgentDef } from "./agents/scripted.ts";
import { keenableMode, keenableSearch, extractCompanyFacts } from "./keenable.ts";

export const GEARGO_DIR = process.env.DELTA_GEARGO_DIR || "/Users/akmal/IdeaProjects/GEARGO/apps/vendure/src/seed";
const FILES = ["products.csv", "sellers/rax-motors-brake-pads.json", "translations/products.json", "translations/collections.json", "translations/facet-values.json"];

export function geargoAvailable(): boolean {
  return FILES.every((f) => existsSync(join(GEARGO_DIR, f)));
}

export const GENERATED = 1945;

const VEHICLES: [string, string, string][] = [
  ["BYD", "Seagull", "byd-seagull"], ["BYD", "Dolphin", "byd-dolphin"], ["BYD", "Song Plus", "byd-song-plus"], ["BYD", "Han", "byd-han"], ["BYD", "Atto 3", "byd-atto-3"],
  ["XPeng", "G6", "xpeng-g6"], ["XPeng", "G9", "xpeng-g9"], ["XPeng", "X9", "xpeng-x9"], ["XPeng", "P7", "xpeng-p7"],
  ["Tesla", "Model 3", "tesla-model-3"], ["Tesla", "Model Y", "tesla-model-y"],
  ["Li Auto", "L7", "li-auto-l7"], ["Li Auto", "L8", "li-auto-l8"], ["Li Auto", "L9", "li-auto-l9"],
  ["Zeekr", "001", "zeekr-001"], ["Zeekr", "007", "zeekr-007"],
  ["Chery", "Tiggo 7 Pro", "chery-tiggo-7-pro"], ["Haval", "Jolion", "haval-jolion"], ["Changan", "UNI-K", "changan-uni-k"], ["Leapmotor", "C11", "leapmotor-c11"],
];
const CATS: [string, string, number, number, boolean][] = [
  // [category, product noun, min price, max price, can be universal]
  ["Floor Mats", "TPE Floor Mats", 350000, 1600000, false], ["Trunk Mats", "Trunk Liner", 250000, 900000, false],
  ["Lighting", "LED Headlight Assembly", 1200000, 9500000, false], ["Electronics", "Wireless CarPlay Screen", 900000, 4800000, false],
  ["Charging", "Portable EV Charger 7 kW", 2500000, 15000000, true], ["Charging", "Type 2 Charging Cable 5 m", 600000, 2400000, true],
  ["Brakes", "Ceramic Brake Pads (Front)", 280000, 1100000, false], ["Exterior", "Silicone Wiper Blades", 50000, 260000, false],
  ["Exterior", "All-Weather Car Cover", 300000, 1300000, false], ["Interior", "Center Console Organizer", 90000, 420000, false],
  ["Lighting", "Ambient Light Kit", 400000, 1800000, false], ["Electronics", "4K Dashcam", 450000, 2600000, true],
  ["Interior", "Seat Back Tablet Holder", 120000, 520000, true], ["Exterior", "Mud Flaps Set", 110000, 450000, false],
];
const BADGES = ["Verified fitment", "Sale", "New", "Tashkent stock", "Fast delivery"];

/** 1,945 extra products in the real products.csv schema, deterministic (fixed seed). */
function generatedRows(columns: string[], real: Row[]): Row[] {
  const r = rng(2026);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const taken = new Set(real.map((x) => String(x.slug)));
  const tax = String(real[0]?.taxCategory ?? "UZ zero VAT placeholder");
  const out: Row[] = [];
  let i = 0;
  while (out.length < GENERATED) {
    const [make, model, vslug] = pick(VEHICLES);
    const [cat, noun, lo, hi, canUni] = pick(CATS);
    const universal = canUni && r() < 0.45;
    const variant = ["", " Pro", " Plus", " Max", " Lite"][Math.floor(r() * 5)];
    const name = universal ? `Universal ${noun}${variant}` : `${make} ${model} ${noun}${variant}`;
    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    let k = 2;
    while (taken.has(slug)) slug = `${slug.replace(/-\d+$/, "")}-${k++}`;
    taken.add(slug);
    i++;
    const price = Math.round((lo + r() * (hi - lo)) / 1000) * 1000;
    const brand = universal ? pick(["GEARGO Select", "AutoPro", "EVLine", "TechCare"]) : `${make} Fit`;
    const row: Row = {};
    for (const c of columns) row[c] = "";
    Object.assign(row, {
      name,
      slug,
      description: `${name}. Generated demo listing in the GEARGO catalog format for Tashkent EV owners.`,
      facets: `category:${cat}|brand:${brand}${universal ? "" : `|vehicle:${vslug}`}`,
      sku: `GG-${1000 + i}-${(universal ? "UNIVERSAL" : vslug.replace(/-/g, "").toUpperCase()).slice(0, 9)}`,
      price: String(price),
      taxCategory: tax,
      stockOnHand: String(Math.floor(r() * 121)),
      trackInventory: "true",
      "product:brand": brand,
      "product:shortDescription": `${noun} for ${universal ? "most EVs" : `${make} ${model}`}.`,
      "product:featureBullets": "Checked fitment|Tashkent warehouse|12-month warranty",
      "product:compatibleVehicleSlugs": universal ? "" : vslug,
      "product:isUniversalFit": universal ? "true" : "false",
      "product:badges": pick(BADGES),
      "product:warrantyNote": "12-month seller warranty",
      "product:deliveryNote": "1–2 days in Tashkent",
      "product:salePrice": r() < 0.2 ? String(Math.round((price * 0.9) / 1000) * 1000) : "",
      "product:visualTone": pick(["dark", "light", "neutral"]),
    });
    out.push(row);
  }
  return out;
}

/** Real rows first (unchanged), then the generated ones. */
function buildCatalog(realCsv: string): { csv: string; real: number; total: number } {
  const recs = parse(realCsv, { columns: true, skip_empty_lines: true, bom: true }) as Row[];
  const columns = Object.keys(recs[0] ?? {});
  const gen = generatedRows(columns, recs);
  return { csv: stringify([...recs, ...gen], { header: true, columns }), real: recs.length, total: recs.length + gen.length };
}

export const catalogInfo = { real: 55, generated: GENERATED, total: 55 + GENERATED };

export function geargoFiles(): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const f of FILES) out[f] = readFileSync(join(GEARGO_DIR, f));
  const cat = buildCatalog(out["products.csv"].toString("utf8"));
  out["products.csv"] = Buffer.from(cat.csv);
  catalogInfo.real = cat.real;
  catalogInfo.total = cat.total;
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

/** Rogue damage at catalog scale: the real PR #106 cases plus generated ones (disjoint sets). */
export const DAMAGE = { removed: 40, prices: 60, fitment: 25, stock: 45, repriced: 800 };
export const damageSets = { removed: new Set(REMOVED), prices: new Map(Object.entries(PRICE_DIV)), fitment: new Set([FITMENT_WIPED]), stock: new Set(STOCK_ZEROED) };
function planDamage(rows: Row[]) {
  damageSets.removed = new Set(REMOVED);
  damageSets.prices = new Map(Object.entries(PRICE_DIV));
  damageSets.fitment = new Set([FITMENT_WIPED]);
  damageSets.stock = new Set(STOCK_ZEROED);
  const used = new Set<string>([...REMOVED, ...Object.keys(PRICE_DIV), FITMENT_WIPED, ...STOCK_ZEROED]);
  const gen = rows.filter((x) => /^GG-1\d{3}/.test(String(x.sku))).sort((a, b) => hash(String(a.slug)) - hash(String(b.slug)));
  const take = (n: number, ok: (x: Row) => boolean, add: (x: Row) => void) => {
    for (const x of gen) {
      if (n <= 0) break;
      const sl = String(x.slug);
      if (used.has(sl) || !ok(x)) continue;
      used.add(sl);
      add(x);
      n--;
    }
  };
  take(DAMAGE.removed - REMOVED.length, () => true, (x) => damageSets.removed.add(String(x.slug)));
  take(DAMAGE.prices - Object.keys(PRICE_DIV).length, (x) => Number(x.price) >= 500000, (x) => damageSets.prices.set(String(x.slug), Math.round((Number(x.price) * 1.04) / 100 / 10) * 10));
  take(DAMAGE.fitment - 1, (x) => String(x["product:isUniversalFit"]) !== "true" && !!String(x["product:compatibleVehicleSlugs"]), (x) => damageSets.fitment.add(String(x.slug)));
  take(DAMAGE.stock - STOCK_ZEROED.length, (x) => Number(x.stockOnHand) > 0, (x) => damageSets.stock.add(String(x.slug)));
}

const repricer: AgentDef = {
  id: "G1",
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
            if (n >= DAMAGE.repriced || hash(String(r.sku)) % 5 === 0) continue;
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

type Step = AgentDef["steps"][number];
type Ctx = Parameters<Step["run"]>[0];
const note = (name: string, thought: string, path: string, text: string): Step => ({ name, thought, run: async (ctx: Ctx) => void (await ctx.writeText(path, text)) });
const editRows = (name: string, thought: string, label: string, fn: (rows: Row[]) => number): Step => ({
  name,
  thought,
  run: async (ctx: Ctx) => {
    const t = await ctx.readCsv(CSV);
    const n = await ctx.compute(label, () => fn(t.rows), (n) => `${fmt(n)} rows changed`);
    await ctx.writeCsv(CSV, t.columns, t.rows, `${fmt(n)} rows changed`);
  },
});
const scan = (name: string, thought: string, path: string): Step => ({
  name,
  thought,
  run: async (ctx: Ctx) => {
    const t = await ctx.readCsv(CSV);
    await ctx.writeJson(path, { products: t.rows.length, at: "base" }, `${fmt(t.rows.length)} products`);
  },
});

// ---- 2. Catalog cleaner
const cleanerSteps = (fuzzy: boolean): Step[] => [
  scan("Scan catalog for duplicates", "Look for products that might be listed twice.", "notes/cleanup_scan.json"),
  {
    name: "Build SKU index",
    thought: "Index products by SKU so merges are cheap.",
    run: async (ctx: Ctx) => {
      const t = await ctx.readCsv(CSV);
      await ctx.writeJson(".clean/sku_index.json", Object.fromEntries(t.rows.map((r) => [String(r.sku), String(r.slug)])), `${t.rows.length} SKUs`);
    },
  },
  fuzzy
    ? {
        name: "Merge near-duplicate products",
        thought: "Products for the same vehicle with similar names look like duplicates; keep one of each.",
        run: async (ctx: Ctx) => {
          const t = await ctx.readCsv(CSV);
          const kept = await ctx.compute("merge_fuzzy.py --by vehicle,name", () => t.rows.filter((r) => !damageSets.removed.has(String(r.slug))), (k) => `${t.rows.length - k.length} near-duplicates merged`);
          await ctx.writeCsv(CSV, t.columns, kept);
        },
      }
    : {
        name: "Merge exact duplicate SKUs",
        thought: "Only identical SKUs are duplicates; names that merely look alike are different products.",
        run: async (ctx: Ctx) => {
          const t = await ctx.readCsv(CSV);
          const seen = new Set<string>();
          const kept = await ctx.compute("merge_exact.py --by sku", () => t.rows.filter((r) => (seen.has(String(r.sku)) ? false : (seen.add(String(r.sku)), true))), (k) => `${t.rows.length - k.length} exact duplicates merged`);
          await ctx.writeCsv(CSV, t.columns, kept);
        },
      },
  note("Write cleanup report", "Summarize the cleanup for the catalog team.", "notes/cleanup_report.md", fuzzy ? "# Cleanup\n\nMerged near-duplicate products. No products lost.\n" : "# Cleanup\n\nExact SKU duplicates only (none found). Nothing removed.\n"),
  { name: "Remove temporary index", thought: "Clean up the scratch index.", run: async (ctx: Ctx) => void (await ctx.remove(".clean/sku_index.json")) },
];
const cleaner: AgentDef = { id: "G2", name: "Catalog cleaner (fuzzy)", role: "Dedupe the catalog", goal: "Remove duplicate products from products.csv.", steps: cleanerSteps(true) };

// ---- 4. Price normalizer
const normalizerSteps = (unitsBug: boolean): Step[] => [
  scan("Profile price magnitudes", "Check the spread of prices before touching anything.", "notes/price_profile.json"),
  note("Detect currency unit", "Prices are in UZS; some look very large.", "notes/price_unit.md", unitsBug ? "Assumed unit: tiyin for prices over 500,000.\n" : "Unit: whole UZS (no minor unit).\n"),
  editRows("Round prices to 10 UZS", "Round to whole 10 UZS so price tags look clean.", "round_prices.py", (rows) => {
    let n = 0;
    for (const r of rows) { const v = Math.round(Number(r.price) / 10) * 10; if (String(v) !== r.price) { r.price = String(v); n++; } }
    return n;
  }),
  unitsBug
    ? editRows("Convert tiyin to sum", "Some prices look like they are stored in tiyin; divide by 100 to get sum.", "tiyin_to_sum.py", (rows) => {
        let n = 0;
        for (const r of rows) { const v = damageSets.prices.get(String(r.slug)); if (v !== undefined) { r.price = String(v); n++; } }
        return n;
      })
    : note("Keep whole UZS prices", "UZS has no minor unit, so no price is divided.", "notes/price_units_checked.md", "Checked: every price is whole UZS. Nothing divided.\n"),
  note("Write pricing note", "Leave a note for the pricing team.", "notes/pricing.md", "# Pricing\n\nRounded to 10 UZS and normalized units.\n"),
];
const normalizer: AgentDef = { id: "G4", name: "Price normalizer (units)", role: "Normalize price units", goal: "Normalize price formatting and units in products.csv.", steps: normalizerSteps(true) };

// ---- 5. Fitment mapper
const fitmentSteps = (bug: boolean): Step[] => [
  scan("Load vehicle catalog", "Collect every vehicle slug used in fitment.", "notes/vehicles.json"),
  note("Map make/model aliases", "BYD Song Plus and Song+ are the same vehicle; map aliases.", "notes/vehicle_aliases.json", '{ "song+": "byd-song-plus", "model y": "tesla-model-y" }\n'),
  editRows("Normalize slug case", "Vehicle slugs must be lowercase.", "lowercase_slugs.py", (rows) => {
    let n = 0;
    for (const r of rows) { const v = String(r["product:compatibleVehicleSlugs"]).toLowerCase(); if (v !== r["product:compatibleVehicleSlugs"]) { r["product:compatibleVehicleSlugs"] = v; n++; } }
    return n;
  }),
  note("Check universal-fit flags", "Universal products need no vehicle list.", "notes/universal_check.md", "Universal-fit flags checked.\n"),
  bug
    ? editRows("Remap multi-vehicle fitment", "Fitment lists that don't match the alias map look stale; clear them for re-import.", "remap_fitment.py", (rows) => {
        let n = 0;
        for (const r of rows) if (damageSets.fitment.has(String(r.slug))) { r["product:compatibleVehicleSlugs"] = ""; n++; }
        return n;
      })
    : note("Keep existing fitment", "Unknown aliases are flagged for review; existing fitment stays.", "notes/fitment_review.md", "Flagged for review only. No fitment removed.\n"),
  note("Write fitment report", "Summarize the fitment changes.", "notes/fitment_report.md", "# Fitment\n\nAliases mapped and slugs normalized.\n"),
];
const fitment: AgentDef = { id: "G5", name: "Fitment mapper (vehicles)", role: "Remap vehicle fitment", goal: "Normalize vehicle fitment slugs in products.csv.", steps: fitmentSteps(true) };

// ---- 6. Stock sync
const stockSteps = (bug: boolean): Step[] => [
  {
    name: "Fetch warehouse feed",
    thought: "Pull today's stock counts from the warehouse feed.",
    run: async (ctx: Ctx) => {
      const t = await ctx.readCsv(CSV);
      const feed = t.rows.filter((r) => !damageSets.stock.has(String(r.slug))).map((r) => ({ sku: r.sku, stock: Number(r.stockOnHand) }));
      await ctx.writeJson("sellers/warehouse_feed.json", feed, `${feed.length} SKUs in feed`);
    },
  },
  scan("Match feed to SKUs", "Join the feed to the catalog by SKU.", "notes/stock_match.json"),
  editRows("Reserve stock for open orders", "Hold one unit for each open order on well-stocked items.", "reserve.py", (rows) => {
    let n = 0;
    for (const r of rows) if (Number(r.stockOnHand) > 10 && hash(String(r.sku)) % 9 === 0) { r.stockOnHand = String(Number(r.stockOnHand) - 1); n++; }
    return n;
  }),
  note("Flag low stock", "List items under 5 units for the buyer.", "reports/low_stock.md", "# Low stock\n\nItems under 5 units flagged.\n"),
  editRows("Recount returns", "Returned items go back into stock.", "returns.py", (rows) => {
    let n = 0;
    for (const r of rows) if (Number(r.stockOnHand) > 0 && hash(String(r.slug)) % 17 === 0) { r.stockOnHand = String(Number(r.stockOnHand) + 1); n++; }
    return n;
  }),
  bug
    ? editRows("Zero items missing from feed", "Items missing from today's warehouse feed must be out of stock.", "zero_missing.py", (rows) => {
        let n = 0;
        for (const r of rows) if (damageSets.stock.has(String(r.slug)) && Number(r.stockOnHand) > 0) { r.stockOnHand = "0"; n++; }
        return n;
      })
    : note("Report items missing from feed (dry-run)", "A partial feed is not proof of zero stock; report, don't change.", "reports/missing_from_feed.md", "Items missing from the feed were reported for a manual recount. No stock changed.\n"),
  note("Write sync report", "Summarize the sync.", "notes/stock_sync.md", "# Stock sync\n\nFeed applied, reservations held, returns recounted.\n"),
];
const stock: AgentDef = { id: "G6", name: "Stock sync (warehouse)", role: "Sync stock with warehouse", goal: "Sync stockOnHand in products.csv with the warehouse feed.", steps: stockSteps(true) };

// ---- 7. SEO writer
const seo: AgentDef = {
  id: "G7",
  name: "SEO writer (descriptions)",
  role: "Rewrite short descriptions",
  goal: "Rewrite short descriptions and feature bullets for listings with thin copy.",
  steps: [
    scan("Pick listings with thin copy", "Find listings whose short description is too generic.", "notes/seo_targets.json"),
    ...[0, 1].map((half): Step => editRows(half ? "Rewrite second batch" : "Rewrite first batch", "Lead with the vehicle and the benefit, under 120 characters.", "rewrite.py", (rows) => {
      let n = 0;
      const targets = rows.filter((r) => hash(String(r.sku)) % 7 < 1 || hash(String(r.slug)) % 11 === 0).slice(0, 300);
      const chunk = half ? targets.slice(150) : targets.slice(0, 150);
      for (const r of chunk) { r["product:shortDescription"] = `${r.name}: checked fitment, ready in Tashkent in 1–2 days.`; n++; }
      return n;
    })),
    editRows("Add feature bullets", "Three bullets per listing: fit, warranty, delivery.", "bullets.py", (rows) => {
      let n = 0;
      for (const r of rows) if (String(r["product:shortDescription"]).includes("checked fitment, ready in Tashkent")) { r["product:featureBullets"] = "Checked vehicle fitment|12-month warranty|Same-week delivery in Tashkent"; n++; }
      return n;
    }),
    note("Write SEO report", "Summarize the copy changes.", "notes/seo_report.md", "# SEO\n\n300 listings rewritten.\n"),
  ],
};

// ---- 8. Promo planner
const promo: AgentDef = {
  id: "G8",
  name: "Promo planner (sales)",
  role: "Plan 5–15% sales",
  goal: "Set sale prices 5–15% off on slow-moving products, never above list.",
  steps: [
    scan("Pick slow movers", "High stock and no recent sale price: good promo candidates.", "notes/promo_candidates.json"),
    editRows("Set sale prices 5–15% off", "Discount slow movers by 5–15%, rounded to 1,000 UZS.", "promo.py", (rows) => {
      let n = 0;
      for (const r of rows) {
        if (n >= 120) break;
        if (Number(r.stockOnHand) >= 60 && !String(r["product:salePrice"])) {
          const off = 5 + (hash(String(r.slug)) % 11);
          r["product:salePrice"] = String(Math.round((Number(r.price) * (1 - off / 100)) / 1000) * 1000);
          n++;
        }
      }
      return n;
    }),
    note("Check sales stay below list", "Every sale price must be below its list price.", "notes/promo_check.md", "All sale prices are below list.\n"),
    note("Write promo calendar", "Publish the promo plan for the week.", "notes/promo_calendar.md", "# Promo week\n\n120 items at 5–15% off.\n"),
  ],
};

const BRANDS = ["BYD", "Tesla", "XPeng", "Li Auto", "Leapmotor"];
const translator: AgentDef = {
  id: "G3",
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

export const GEARGO_AGENTS: AgentDef[] = [repricer, cleaner, translator, normalizer, fitment, stock, seo, promo];
const SAFE: Record<string, AgentDef> = {
  "Catalog cleaner (exact SKU)": { ...cleaner, name: "Catalog cleaner (exact SKU)", role: "Dedupe by exact SKU only", steps: cleanerSteps(false) },
  "Price normalizer (UZS-aware)": { ...normalizer, name: "Price normalizer (UZS-aware)", role: "Normalize prices, whole UZS", steps: normalizerSteps(false) },
  "Fitment mapper (keep existing)": { ...fitment, name: "Fitment mapper (keep existing)", role: "Map aliases, keep fitment", steps: fitmentSteps(false) },
  "Stock sync (dry-run)": { ...stock, name: "Stock sync (dry-run)", role: "Sync stock, report gaps", steps: stockSteps(false) },
};
export const SAFE_FOR: Record<string, string> = {
  "Catalog cleaner (fuzzy)": "Catalog cleaner (exact SKU)",
  "Price normalizer (units)": "Price normalizer (UZS-aware)",
  "Fitment mapper (vehicles)": "Fitment mapper (keep existing)",
  "Stock sync (warehouse)": "Stock sync (dry-run)",
};
export const GEARGO_FORK_VARIANTS = Object.keys(SAFE);
export function geargoVariant(name: string): AgentDef | undefined {
  const d = SAFE[name] ?? GEARGO_AGENTS.find((a) => a.name === name);
  return d ? { ...d, id: "" } : undefined;
}

/** Baseline products by SKU, used by the drift / fitment / stock invariants. */
export const baseline = new Map<string, Row>();
export function setBaseline(rows: Row[]) {
  baseline.clear();
  for (const r of rows) baseline.set(String(r.sku), r);
  planDamage(rows);
}
