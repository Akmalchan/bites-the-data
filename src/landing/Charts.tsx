// "Watch it happen": the GEARGO team of 8, drawn to scale from a real scripted run
// (2,000 products: 55 real GEARGO + 1,945 generated). Values measured per checkpoint.

// Steps per agent (G3 runs 4 when Keenable is configured; its product count never changes).
const LANES: { id: string; steps: number }[] = [
  { id: "G1", steps: 4 }, { id: "G3", steps: 4 }, { id: "G4", steps: 5 }, { id: "G5", steps: 6 },
  { id: "G6", steps: 7 }, { id: "G7", steps: 5 }, { id: "G8", steps: 4 },
];
const G2_ROWS = [2000, 2000, 2000, 1960, 1960, 1960]; // Catalog cleaner (fuzzy)
const G4_BIG = [0, 0, 0, 0, 60, 60]; // prices moved more than ±20% vs base, by step
const BAD = "#D7263D";
const G2C = "#E07A1F";

const fmt = (n: number) => n.toLocaleString("en-US");

export function RowsChart() {
  const W = 560, H = 300, L = 58, R = 18, T = 26, Bm = 40;
  const y0 = 1930, y1 = 2015, maxS = 7;
  const x = (s: number) => L + (s / maxS) * (W - L - R);
  const y = (v: number) => T + ((y1 - v) / (y1 - y0)) * (H - T - Bm);
  return (
    <figure className="ch-card">
      <figcaption>
        <b>products.csv · products in catalog by step</b>
        <span className="ch-leg">
          <i style={{ background: G2C }} />G2 Catalog cleaner <i style={{ background: "#9AA0AA" }} />7 other agents
        </span>
      </figcaption>
      <div className="ch-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} className="ch-svg ch-rows" role="img" aria-label="Products by step: seven agents stay at 2,000. G2 drops to 1,960 at step 3 (40 products removed by fuzzy dedupe).">
          {[1940, 1960, 1980, 2000].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ch-grid" />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" className="ch-ax">{fmt(v)}</text>
            </g>
          ))}
          {Array.from({ length: maxS + 1 }, (_, s) => (
            <text key={s} x={x(s)} y={H - Bm + 18} textAnchor="middle" className="ch-ax">{s === 0 ? "base" : s}</text>
          ))}
          <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="ch-ax">agent step</text>
          {LANES.map((l) => (
            <line key={l.id} x1={x(0)} x2={x(l.steps)} y1={y(2000)} y2={y(2000)} stroke="#9AA0AA" strokeWidth={2} opacity={0.55} />
          ))}
          <line x1={L} x2={W - R} y1={y(2000) - 0.5} y2={y(2000) - 0.5} className="ch-rule" />
          <text x={W - R} y={y(2000) - 9} textAnchor="end" className="ch-rulet">rule: no product removed (≥ 2,000)</text>
          <path d={G2_ROWS.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ")} stroke={G2C} className="ch-line" />
          {G2_ROWS.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={i === 3 ? 6.5 : 3.5} fill={i === 3 ? "#fff" : G2C} stroke={i === 3 ? BAD : G2C} strokeWidth={i === 3 ? 3 : 1.5} />
          ))}
          <text x={x(maxS)} y={y(2000) + 18} textAnchor="end" className="ch-lab mute">7 other agents: 2,000 products, none removed</text>
          <line x1={x(3)} x2={x(3) + 36} y1={y(1960)} y2={y(1960) + 26} className="ch-call" />
          <text x={x(3) + 40} y={y(1960) + 30} className="ch-lab bad">40 products removed</text>
          <text x={x(3) + 40} y={y(1960) + 46} className="ch-lab mute">G2 step 3: fuzzy dedupe</text>
        </svg>
      </div>
    </figure>
  );
}

export function DealsChart() {
  const W = 360, H = 300, L = 40, R = 10, T = 26, Bm = 40;
  const max = 80;
  const bw = (W - L - R) / G4_BIG.length;
  const y = (v: number) => T + (1 - v / max) * (H - T - Bm);
  return (
    <figure className="ch-card">
      <figcaption>
        <b>G4 · prices moved over ±20%</b>
        <span className="ch-leg">products, vs base, by step</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="ch-svg" role="img" aria-label="G4 price normalizer: no price moves more than 20% through step 3; 60 prices divided by 100 at step 4.">
        {[0, 20, 40, 60, 80].map((m) => (
          <g key={m}>
            <line x1={L} x2={W - R} y1={y(m)} y2={y(m)} className="ch-grid" />
            <text x={L - 8} y={y(m) + 4} textAnchor="end" className="ch-ax">{m}</text>
          </g>
        ))}
        {G4_BIG.map((v, i) => (
          <g key={i}>
            {v > 0 ? <rect x={L + i * bw + 6} y={y(v)} width={bw - 12} height={y(0) - y(v)} fill={BAD} /> : <rect x={L + i * bw + 6} y={y(0) - 2} width={bw - 12} height={2} fill="#12965A" />}
            <text x={L + i * bw + bw / 2} y={H - Bm + 18} textAnchor="middle" className="ch-ax">{i === 0 ? "base" : i}</text>
          </g>
        ))}
        <text x={L + 4 * bw - 4} y={y(60) + 4} textAnchor="end" className="ch-lab bad">60 prices ÷100</text>
        <text x={L + 4 * bw - 4} y={y(60) + 20} textAnchor="end" className="ch-lab mute">step 4: "tiyin to sum"</text>
        <text x={L + 2 * bw} y={y(0) - 12} textAnchor="middle" className="ch-lab mute">0 through step 3</text>
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="ch-ax">agent step</text>
      </svg>
    </figure>
  );
}

const DIFF_ROWS: { tag: string; cls: "lost" | "warn" | "merged"; agent: string; sku: string; slug: string; field: string; before: string; after: string; ok?: boolean }[] = [
  { tag: "removed", cls: "lost", agent: "G2@3", sku: "GG-0018-TESLAMODE", slug: "tesla-model-y-frunk-organizer", field: "row", before: "620,000 UZS", after: "removed" },
  { tag: "÷100", cls: "warn", agent: "G4@4", sku: "GG-0003-BYDSONGP", slug: "byd-song-plus-led-headlight-assembly", field: "price", before: "2,800,000", after: "29,130" },
  { tag: "fitment", cls: "lost", agent: "G5@5", sku: "GG-0017-TESLAMODE", slug: "tesla-model-3-y-aluminum-pedal-set", field: "compatibleVehicleSlugs", before: "tesla-model-3|tesla-model-y", after: "empty" },
  { tag: "stock", cls: "warn", agent: "G6@6", sku: "GG-0012-LIAUTOL8", slug: "li-auto-l8-rear-seat-tablet-holder", field: "stockOnHand", before: "26", after: "0" },
  { tag: "routine", cls: "merged", agent: "G1@2", sku: "GG-0001-BYDSEAGUL", slug: "byd-seagull-tpe-floor-mats", field: "price", before: "790,000", after: "819,230 (+3.7%)", ok: true },
];

export function DiffExample() {
  return (
    <figure className="ch-card ch-wide">
      <figcaption>
        <b>Typed diff · products.csv, keyed by sku</b>
        <span className="ch-leg">5 real rows from the run: one per rogue agent, plus one routine change</span>
      </figcaption>
      <div className="dx-wrap">
        <table className="dx">
          <thead>
            <tr><th /><th>Agent</th><th>Product</th><th>Field</th><th>Before → after</th></tr>
          </thead>
          <tbody>
            {DIFF_ROWS.map((r) => (
              <tr key={r.sku} className={r.ok ? "" : r.cls === "lost" ? "lost" : "changed"}>
                <td><b className={`tag ${r.cls}`}>{r.tag}</b></td>
                <td className="mono">{r.agent}</td>
                <td className="mono">{r.slug}</td>
                <td className="mono">{r.field}</td>
                <td className="mono">
                  <s>{r.before}</s> <span className="dx-arr">→</span> <b className={r.ok ? "g" : "r"}>{r.after}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
