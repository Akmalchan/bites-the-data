// Deterministic seed world for the data-cleaning scenario.
// customers.csv (5,000 rows: 4,601 unique people + 87 exact duplicates + 312
// legit "lookalike" customers that a careless fuzzy dedupe will wrongly merge),
// crm.sqlite (customers + deals), config.json, notes/, assets/, cache/.
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "csv-stringify/sync";

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const LOOKALIKES: [string, string][] = [
  ["Maria", "Mario"], ["Daniel", "Daniela"], ["Jon", "John"], ["Ann", "Anna"], ["Eric", "Erica"],
  ["Paul", "Paula"], ["Carl", "Carla"], ["Alex", "Alexa"], ["Leo", "Lea"], ["Sara", "Sarah"],
  ["Lena", "Lina"], ["Ivan", "Ivana"], ["Marc", "Mark"], ["Juan", "Juana"], ["Dana", "Dina"],
  ["Adrian", "Adriana"], ["Gabriel", "Gabriela"], ["Julian", "Juliana"], ["Martin", "Martina"], ["Simon", "Simona"],
];
const OTHER_FIRST = [
  "Olivia", "Liam", "Emma", "Noah", "Ava", "Ethan", "Mia", "Lucas", "Zoe", "Omar", "Priya", "Arjun", "Wei", "Yuki",
  "Hana", "Kenji", "Fatima", "Aisha", "Mateo", "Sofia", "Lukas", "Emil", "Freya", "Nora", "Hugo", "Chloe", "Ravi",
  "Ines", "Tomas", "Elena", "Diego", "Leila", "Sven", "Astrid", "Kofi", "Amara", "Tariq", "Mei", "Jun", "Rosa",
];
const LAST = [
  "Chen", "Patel", "Garcia", "Smith", "Nguyen", "Kim", "Muller", "Rossi", "Silva", "Kowalski", "Tanaka", "Sato",
  "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Martinez", "Lopez", "Wilson", "Anderson", "Thomas",
  "Moore", "Martin", "Jackson", "Lee", "Walker", "Hall", "Allen", "Young", "King", "Wright", "Scott", "Green",
  "Baker", "Adams", "Nelson", "Hill", "Campbell", "Mitchell", "Roberts", "Carter", "Phillips", "Evans", "Turner",
  "Torres", "Parker", "Collins", "Edwards", "Stewart", "Morris", "Murphy", "Cook", "Rogers", "Morgan", "Peterson",
  "Cooper", "Reed", "Bailey", "Bell", "Gomez", "Kelly", "Howard", "Ward", "Cox", "Diaz", "Richardson", "Wood",
  "Watson", "Brooks", "Bennett", "Gray", "James", "Reyes", "Cruz", "Hughes", "Price", "Myers", "Long", "Foster",
  "Sanders", "Ross", "Morales", "Powell", "Sullivan", "Russell", "Ortiz", "Jenkins", "Gutierrez", "Perry", "Butler",
  "Barnes", "Fisher", "Henderson", "Coleman", "Simmons", "Patterson", "Jordan", "Reynolds", "Hamilton", "Graham",
  "Kumar", "Singh", "Sharma", "Ito", "Yamamoto", "Nakamura", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer",
  "Dubois", "Moreau", "Laurent", "Bernard", "Okafor", "Mensah", "Haddad", "Novak", "Horvat", "Larsen", "Nilsen",
];
const SYL_A = ["North", "Blue", "Iron", "Silver", "Bright", "Cedar", "Quantum", "Apex", "Harbor", "Summit", "Atlas", "Nova", "Pine", "River", "Stone", "Vector", "Orbit", "Lumen", "Copper", "Falcon"];
const SYL_B = ["wind", "field", "gate", "path", "works", "line", "bridge", "point", "forge", "stack", "grid", "leaf", "wave", "peak", "loop"];
const SUFFIX = ["Labs", "Inc", "Systems", "Analytics", "Health", "Logistics", "Capital", "Studio", "Foods", "Robotics", "Energy", "Retail"];
const TLD = ["io", "com", "co", "ai", "dev"];

interface Country {
  code: string;
  cc: string;
  weight: number;
  phone: (r: () => number) => string;
}
const d = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join("");
const usPhone = (r: () => number) => {
  const a = `${2 + Math.floor(r() * 8)}${d(r, 2)}`, b = `${2 + Math.floor(r() * 8)}${d(r, 2)}`, c = d(r, 4);
  const s = Math.floor(r() * 5);
  return [`(${a}) ${b}-${c}`, `${a}.${b}.${c}`, `${a}-${b}-${c}`, `+1 ${a} ${b} ${c}`, `${a}${b}${c}`][s];
};
const intl = (cc: string, groups: number[]) => (r: () => number) => {
  const parts = groups.map((g) => d(r, g));
  const s = Math.floor(r() * 3);
  return [`+${cc} ${parts.join(" ")}`, `+${cc}-${parts.join("-")}`, `00${cc} ${parts.join(" ")}`][s];
};
export const COUNTRIES: Country[] = [
  { code: "US", cc: "1", weight: 45, phone: usPhone },
  { code: "GB", cc: "44", weight: 12, phone: intl("44", [2, 4, 4]) },
  { code: "DE", cc: "49", weight: 10, phone: intl("49", [2, 4, 4]) },
  { code: "FR", cc: "33", weight: 8, phone: intl("33", [1, 2, 2, 2, 2]) },
  { code: "CA", cc: "1", weight: 7, phone: usPhone },
  { code: "JP", cc: "81", weight: 6, phone: intl("81", [2, 4, 4]) },
  { code: "IN", cc: "91", weight: 6, phone: intl("91", [5, 5]) },
  { code: "AU", cc: "61", weight: 6, phone: intl("61", [1, 4, 4]) },
];

export const REAL_COMPANIES = [
  "Stripe", "Figma", "Datadog", "Notion", "Airtable", "Vercel", "Ramp", "Rippling", "Gusto", "Brex", "Plaid", "Canva", "Twilio",
  "Zapier", "Asana", "Linear", "Retool", "Snowflake", "Databricks", "HubSpot", "Shopify", "Cloudflare", "Atlassian", "Dropbox", "Duolingo",
];

export interface SeedInfo {
  customers: number;
  uniquePeople: number;
  exactDuplicates: number;
  lookalikes: number;
  missingCountry: number;
  deals: number;
  dealTotal: number;
}

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  country: string;
  company: string;
  created_at: string;
}

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length)];
}

function pickCountry(r: () => number): Country {
  const total = COUNTRIES.reduce((s, c) => s + c.weight, 0);
  let x = r() * total;
  for (const c of COUNTRIES) if ((x -= c.weight) < 0) return c;
  return COUNTRIES[0];
}

function messyCase(r: () => number, email: string): string {
  if (r() > 0.35) return email;
  const [local, domain] = email.split("@");
  const cap = local.split(".").map((p) => p[0].toUpperCase() + p.slice(1)).join(".");
  return r() < 0.5 ? `${cap}@${domain}` : `${cap}@${domain[0].toUpperCase()}${domain.slice(1)}`;
}

export function generate(seed = 42, total = 5000, dupCount = 87, lookCount = 312) {
  const r = rng(seed);
  const companies = new Set<string>();
  while (companies.size < 420) companies.add(`${pick(r, SYL_A)}${pick(r, SYL_B)} ${pick(r, SUFFIX)}`);
  const companyList = [...companies];
  const domainOf = new Map(companyList.map((c) => [c, `${c.split(" ")[0].toLowerCase()}.${pick(r, TLD)}`]));
  const lookFirst = new Map<string, string>();
  for (const [a, b] of LOOKALIKES) lookFirst.set(a, b);
  const firstPool = [...LOOKALIKES.map((p) => p[0]), ...OTHER_FIRST];

  const usedLastCompany = new Set<string>();
  const usedEmail = new Set<string>();
  const people: Omit<Customer, "id">[] = [];
  const uniqueCount = total - dupCount - lookCount;
  const lookalikeSources: number[] = [];

  const makeEmail = (first: string, last: string, company: string) => {
    let e = `${first}.${last}@${domainOf.get(company)}`.toLowerCase();
    let n = 2;
    while (usedEmail.has(e)) e = `${first}.${last}${n++}@${domainOf.get(company)}`.toLowerCase();
    usedEmail.add(e);
    return e;
  };
  const date = () => {
    const t = Date.UTC(2021, 0, 1) + Math.floor(r() * (Date.UTC(2026, 9, 1) - Date.UTC(2021, 0, 1)));
    return new Date(t).toISOString().slice(0, 19) + "Z";
  };

  for (let i = 0; i < uniqueCount; i++) {
    let first: string, last: string, company: string;
    do {
      first = pick(r, firstPool);
      last = pick(r, LAST);
      company = pick(r, companyList);
    } while (usedLastCompany.has(`${last}|${company}`));
    usedLastCompany.add(`${last}|${company}`);
    const c = pickCountry(r);
    let name = `${first} ${last}`;
    if (r() < 0.05) name = r() < 0.5 ? `${first}  ${last}` : ` ${first} ${last} `;
    people.push({
      name,
      email: messyCase(r, makeEmail(first, last, company)),
      phone: c.phone(r),
      country: r() < 0.085 ? "" : c.code,
      company,
      created_at: date(),
    });
    if (lookFirst.has(first)) lookalikeSources.push(i);
  }
  if (lookalikeSources.length < lookCount + dupCount) throw new Error("not enough lookalike sources");

  // Legit lookalikes: a different real person at the same company with a near-identical first name.
  const rows: Omit<Customer, "id">[] = [...people];
  const shuffledSources = [...lookalikeSources].sort(() => r() - 0.5);
  for (let k = 0; k < lookCount; k++) {
    const src = people[shuffledSources[k]];
    const [first, last] = src.name.trim().split(/\s+/);
    const twin = lookFirst.get(first)!;
    const c = pickCountry(r);
    rows.push({
      name: `${twin} ${last}`,
      email: messyCase(r, makeEmail(twin, last, src.company)),
      phone: c.phone(r),
      country: r() < 0.085 ? "" : c.code,
      company: src.company,
      created_at: date(),
    });
  }
  // Exact duplicates: the same person entered twice (email differs only in case, phone in format).
  const dupSources = [...Array(uniqueCount).keys()].filter((i) => !shuffledSources.slice(0, lookCount).includes(i)).sort(() => r() - 0.5);
  for (let k = 0; k < dupCount; k++) {
    const src = people[dupSources[k]];
    const c = COUNTRIES.find((x) => x.code === src.country) ?? COUNTRIES[0];
    const flipped = src.email === src.email.toLowerCase() ? src.email.toUpperCase().replace(/@.*/, (m) => m.toLowerCase()) : src.email.toLowerCase();
    rows.push({ ...src, email: flipped, phone: c.phone(r), created_at: date() });
  }
  // Interleave so duplicates are not trivially at the end.
  for (let i = rows.length - 1; i > uniqueCount / 2; i--) {
    const j = Math.floor(r() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const customers: Customer[] = rows.map((row, i) => ({ id: i + 1, ...row }));
  // The first companies the Enricher will look up on the web (accounts with a missing country) are renamed to
  // real, well-known companies so web search returns clean matches. A one-to-one rename after generation keeps
  // every other number in the seed identical. People and email domains stay fake.
  const lookupOrder = [...new Set(customers.filter((c) => c.country === "").map((c) => c.company))].slice(0, REAL_COMPANIES.length);
  const rename = new Map(lookupOrder.map((c, i) => [c, REAL_COMPANIES[i]]));
  for (const c of customers) c.company = rename.get(c.company) ?? c.company;

  // Deals
  const deals: { id: number; customer_id: number; title: string; stage: string; amount: number; currency: string; created_at: string }[] = [];
  const stages = ["prospect", "qualified", "proposal", "won", "lost"];
  const nDeals = 1800;
  for (let i = 1; i <= nDeals; i++) {
    const big = r() < 0.15;
    const amount = big ? 52000 + Math.round((r() * 188000) / 50) * 50 : 1000 + Math.round((r() * 44000) / 50) * 50;
    deals.push({
      id: i,
      customer_id: 1 + Math.floor(r() * total),
      title: `${pick(r, ["Annual", "Pilot", "Expansion", "Renewal", "Enterprise"])} ${pick(r, ["plan", "license", "seats", "contract", "pilot"])}`,
      stage: pick(r, stages),
      amount,
      currency: "USD",
      created_at: date(),
    });
  }
  const info: SeedInfo = {
    customers: customers.length,
    uniquePeople: total - dupCount,
    exactDuplicates: dupCount,
    lookalikes: lookCount,
    missingCountry: customers.filter((c) => c.country === "").length,
    deals: deals.length,
    dealTotal: deals.reduce((s, x) => s + x.amount, 0),
  };
  return { customers, deals, info };
}

export const CUSTOMER_COLUMNS = ["id", "name", "email", "phone", "country", "company", "created_at"];

export function customersCsv(rows: Record<string, unknown>[], columns = CUSTOMER_COLUMNS): string {
  return stringify(rows, { header: true, columns });
}

export function buildSqlite(customers: Customer[], deals: ReturnType<typeof generate>["deals"]): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "delta-seed-"));
  const p = join(dir, "crm.sqlite");
  const db = new DatabaseSync(p);
  db.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, country TEXT, company TEXT, created_at TEXT);
    CREATE TABLE deals (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), title TEXT, stage TEXT, amount REAL, currency TEXT, created_at TEXT);
    CREATE INDEX deals_customer ON deals(customer_id);
  `);
  db.exec("BEGIN");
  const ic = db.prepare("INSERT INTO customers VALUES (?,?,?,?,?,?,?)");
  for (const c of customers) ic.run(c.id, c.name, c.email, c.phone, c.country, c.company, c.created_at);
  const idl = db.prepare("INSERT INTO deals VALUES (?,?,?,?,?,?,?)");
  for (const x of deals) idl.run(x.id, x.customer_id, x.title, x.stage, x.amount, x.currency, x.created_at);
  db.exec("COMMIT");
  db.close();
  const buf = readFileSync(p);
  rmSync(dir, { recursive: true, force: true });
  return buf;
}

// 1x1 transparent PNG
const LOGO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export function embeddings(seed: number, bytes: number): Buffer {
  const r = rng(seed);
  const b = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) b[i] = Math.floor(r() * 256);
  return b;
}

export const BASE_CONFIG = {
  schema_version: 3,
  project: "acme-crm-cleanup",
  pipeline: { steps: ["normalize", "dedupe", "enrich"], dry_run: false, batch_size: 500 },
  dedupe: { strategy: "exact", match_on: ["email"], fuzzy_threshold: 0.92 },
  sources: [
    { id: "hubspot", enabled: true, last_sync: "2026-11-09T22:10:00Z" },
    { id: "stripe", enabled: true, last_sync: "2026-11-09T22:12:00Z" },
    { id: "clearbit", enabled: false, last_sync: null },
  ],
  owners: ["data-team@acme.example"],
};

export function seedFiles(seed = 42): { files: Record<string, Buffer | string>; info: SeedInfo } {
  const { customers, deals, info } = generate(seed);
  const files: Record<string, Buffer | string> = {
    "customers.csv": customersCsv(customers as unknown as Record<string, unknown>[]),
    "crm.sqlite": buildSqlite(customers, deals),
    "config.json": JSON.stringify(BASE_CONFIG, null, 2) + "\n",
    "notes/README.md": `# ACME CRM cleanup\n\nShared workspace for the data agents.\n\n- customers.csv is the export from HubSpot (${info.customers.toLocaleString()} rows).\n- crm.sqlite mirrors customers and holds deals.\n- Never delete a customer that has no duplicate.\n`,
    "notes/todo.md": "# TODO\n\n- [ ] normalize phone numbers\n- [ ] merge duplicate customers\n- [ ] fill missing countries\n- [ ] add region column for the sales dashboard\n",
    "notes/data_dictionary.md":
      "# Data dictionary\n\n| column | meaning |\n|---|---|\n| id | stable customer id |\n| email | primary contact email (unique per person) |\n| phone | free-form phone, to be normalized to E.164 |\n| country | ISO 3166-1 alpha-2 |\n| company | account name |\n\n## deals\n\n`amount` is in whole US dollars.\n",
    "assets/logo.png": LOGO,
    "cache/embeddings.bin": embeddings(seed, 768 * 1024),
  };
  return { files, info };
}
