// Keenable web search (https://docs.keenable.ai). Raw HTTP, no SDK needed.
// Enabled only when KEENABLE_API_KEY is set (or KEENABLE_KEYLESS=1 for the keyless public endpoint).
// Every response is cached on disk by query, so re-runs cost nothing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface KeenableResult {
  title: string;
  url: string;
  snippet?: string;
  description?: string;
}

const CACHE = resolve("data/keenable-cache.json");
let cache: Record<string, KeenableResult[]> | null = null;
export const keenableStats = { queries: 0, cached: 0, errors: 0 };

export function keenableMode(): "key" | "keyless" | "off" {
  if (process.env.KEENABLE_API_KEY) return "key";
  if (process.env.KEENABLE_KEYLESS === "1") return "keyless";
  return "off";
}

function load(): Record<string, KeenableResult[]> {
  if (cache) return cache;
  try {
    cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
  } catch {
    cache = {};
  }
  return cache!;
}

export async function keenableSearch(query: string, maxResults = 3): Promise<{ results: KeenableResult[]; cached: boolean }> {
  const c = load();
  if (c[query]) {
    keenableStats.cached++;
    return { results: c[query], cached: true };
  }
  const mode = keenableMode();
  if (mode === "off") throw new Error("Keenable not configured");
  const url = mode === "key" ? "https://api.keenable.ai/v1/search" : "https://api.keenable.ai/v1/search/public";
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Keenable-Title": "Delta" };
  if (mode === "key") headers["X-API-Key"] = process.env.KEENABLE_API_KEY!;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, max_results: maxResults, mode: "realtime", snippet_max_length: 400 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 429 && attempt < 2) {
      await new Promise((res) => setTimeout(res, 1000 * Number(r.headers.get("retry-after") ?? 1)));
      continue;
    }
    if (!r.ok) {
      keenableStats.errors++;
      throw new Error(`Keenable HTTP ${r.status}`);
    }
    const body = (await r.json()) as { results?: KeenableResult[] };
    const results = (body.results ?? []).map(({ title, url, snippet, description }) => ({ title, url, snippet, description }));
    keenableStats.queries++;
    c[query] = results;
    mkdirSync("data", { recursive: true });
    writeFileSync(CACHE, JSON.stringify(c, null, 1));
    return { results, cached: false };
  }
}

const COUNTRY: [RegExp, string][] = [
  [/\b(united states|u\.s\.a?\.?|usa|california|new york|texas|delaware)\b/i, "US"],
  [/\b(canada|toronto|vancouver|ontario|british columbia|quebec)\b/i, "CA"],
  [/\b(united kingdom|england|london|scotland|u\.k\.)\b/i, "GB"],
  [/\b(germany|berlin|munich|hamburg|deutschland)\b/i, "DE"],
  [/\b(france|paris|lyon)\b/i, "FR"],
  [/\b(japan|tokyo|osaka)\b/i, "JP"],
  [/\b(india|bangalore|bengaluru|mumbai|delhi|hyderabad)\b/i, "IN"],
  [/\b(australia|sydney|melbourne)\b/i, "AU"],
  [/\b(netherlands|amsterdam)\b/i, "NL"],
  [/\b(ireland|dublin)\b/i, "IE"],
  [/\b(singapore)\b/i, "SG"],
];
// Ordered most specific first; the first label whose pattern appears in the top results wins.
const INDUSTRY: [RegExp, string][] = [
  [/\b(payments?|payment processing|card issuing|corporate cards?|spend management|expense management)\b/i, "Payments & fintech"],
  [/\b(payroll|hr platform|human resources|benefits administration|workforce management)\b/i, "HR & payroll"],
  [/\b(language learning|learn a language|education app)\b/i, "Education"],
  [/\b(observability|monitoring|apm|log management)\b/i, "Observability"],
  [/\b(data cloud|data warehouse|lakehouse|data platform|analytics platform|data intelligence)\b/i, "Data & analytics"],
  [/\b(design tool|interface design|collaborative design|graphic design|visual design|design platform|create designs?|visual communication)\b/i, "Design software"],
  [/\b(sms|voice api|communications api|messaging api|cloud communications|customer engagement platform)\b/i, "Communications APIs"],
  [/\b(open banking|bank accounts?|financial data|fintech|connect (your )?bank)\b/i, "Payments & fintech"],
  [/\b(e-?commerce|online store|sell online|commerce platform|start a business)\b/i, "E-commerce"],
  [/\b(cdn|content delivery|ddos|zero trust|edge network|connectivity cloud)\b/i, "Cloud & security"],
  [/\b(frontend cloud|deploy(ment)? platform|hosting platform|serverless)\b/i, "Developer platform"],
  [/\b(internal tools?|low-code|no-code)\b/i, "Developer tools"],
  [/\b(issue tracking|project management|work management|task management|product development)\b/i, "Project management"],
  [/\b(crm|inbound marketing|marketing software|customer platform)\b/i, "CRM & marketing"],
  [/\b(file (hosting|sharing|storage)|cloud storage)\b/i, "Cloud storage"],
  [/\b(automation|automate workflows|workflow automation)\b/i, "Automation"],
  [/\b(collaboration|wiki|docs|notes|workspace|spreadsheet-database|database)\b/i, "Collaboration software"],
  [/\b(software|saas|platform|developer)\b/i, "Software"],
];

const AGGREGATORS = /(^|\.)(linkedin|wikipedia|crunchbase|bloomberg|forbes|techcrunch|youtube|twitter|x|facebook|instagram|reddit|medium|github|glassdoor|indeed|g2|capterra|zoominfo|pitchbook|cbinsights|businessinsider|cnbc|nytimes|wsj|reuters|apps\.apple|play\.google)\./i;

function host(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Cheap deterministic extraction from the top results.
 * website: the company's own domain when a result is on it (host contains the company slug), else the first non-aggregator host.
 * industry: the most specific keyword label found in titles and snippets. country: a country/city keyword, recorded only.
 */
export function extractCompanyFacts(results: KeenableResult[], company = "") {
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  const own = results.find((r) => slug && host(r.url).replace(/[^a-z0-9.]/g, "").split(".").some((part) => part === slug));
  const nonAgg = results.find((r) => host(r.url) && !AGGREGATORS.test(host(r.url)));
  const pick = own ?? nonAgg ?? results[0];
  const website = pick ? host(pick.url).split(".").slice(-2).join(".") : "";
  const text = results.map((r) => `${r.title} ${r.description ?? ""} ${r.snippet ?? ""}`).join(" ");
  return {
    website,
    country: COUNTRY.find(([re]) => re.test(text))?.[1] ?? "",
    industry: INDUSTRY.find(([re]) => re.test(text))?.[1] ?? "",
    source: pick?.url ?? "",
    title: pick?.title ?? "",
  };
}
