// "Watch it happen": charts drawn to scale from a real scripted run (seed 42).
// Values were measured by running the scripted agents on the seeded CRM world:
// customers.csv row count and round(sum(deals.amount)) at every checkpoint.

const A_ROWS = [5000, 5000, 5000, 5000, 5000, 5000, 5000]; // Formatter (phones), 6 steps
const B_ROWS = [5000, 5000, 5000, 4913, 4601, 4601, 4601, 4601, 4601]; // Merger (fuzzy), 8 steps
const C_ROWS = [5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000]; // Enricher (web), 8 steps with Keenable
const B_DEALS = [72574000, 72574000, 72574000, 72574000, 72574000, 72574000, 34736745, 34736745, 34736745];
const COL = { A: "#2F7DD1", B: "#E07A1F", C: "#0F9E8E" };

const fmt = (n: number) => n.toLocaleString("en-US");

export function RowsChart() {
  const W = 560, H = 300, L = 58, R = 18, T = 22, Bm = 40;
  const y0 = 4400, y1 = 5100;
  const x = (s: number) => L + (s / 8) * (W - L - R);
  const y = (v: number) => T + ((y1 - v) / (y1 - y0)) * (H - T - Bm);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <figure className="ch-card">
      <figcaption>
        <b>customers.csv rows by step</b>
        <span className="ch-leg">
          <i style={{ background: COL.A }} />A Formatter <i style={{ background: COL.B }} />B Merger <i style={{ background: COL.C }} />C Enricher
        </span>
      </figcaption>
      <div className="ch-scroll"><svg viewBox={`0 0 ${W} ${H}`} className="ch-svg ch-rows" role="img" aria-label="Rows by step: A and C stay at 5,000. B drops to 4,913 at step 3 (duplicates merged) and to 4,601 at step 4 (312 real customers lost).">
        {[4500, 4750, 5000].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ch-grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="ch-ax">{fmt(v)}</text>
          </g>
        ))}
        {Array.from({ length: 9 }, (_, s) => (
          <text key={s} x={x(s)} y={H - Bm + 18} textAnchor="middle" className="ch-ax">{s === 0 ? "base" : s}</text>
        ))}
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="ch-ax">agent step</text>
        {/* the rule */}
        <line x1={L} x2={W - R} y1={y(4913)} y2={y(4913)} className="ch-rule" />
        <text x={W - R} y={y(4913) - 6} textAnchor="end" className="ch-rulet">rule: rows ≥ 4,913 (true duplicates only)</text>
        <path d={path(C_ROWS)} stroke={COL.C} className="ch-line" />
        <path d={path(A_ROWS)} stroke={COL.A} className="ch-line" strokeDasharray="6 5" />
        <path d={path(B_ROWS)} stroke={COL.B} className="ch-line" />
        {B_ROWS.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={i === 4 ? 6.5 : 3.5} fill={i === 4 ? "#fff" : COL.B} stroke={i === 4 ? "#D7263D" : COL.B} strokeWidth={i === 4 ? 3 : 1.5} />
        ))}
        <text x={x(8) - 4} y={y(5000) - 8} textAnchor="end" className="ch-lab">A, C: 5,000 rows, nothing lost</text>
        <text x={x(3) - 10} y={y(4913) + 18} textAnchor="end" className="ch-lab mute">step 3: −87 exact duplicates (fine)</text>
        <g>
          <line x1={x(4)} x2={x(4) + 40} y1={y(4601)} y2={y(4601) + 34} className="ch-call" />
          <text x={x(4) + 44} y={y(4601) + 38} className="ch-lab bad">312 real customers lost</text>
          <text x={x(4) + 44} y={y(4601) + 54} className="ch-lab mute">step 4: fuzzy-merge</text>
        </g>
      </svg></div>
    </figure>
  );
}

export function DealsChart() {
  const W = 360, H = 300, L = 52, R = 10, T = 22, Bm = 40;
  const max = 80_000_000;
  const bw = (W - L - R) / 9;
  const y = (v: number) => T + (1 - v / max) * (H - T - Bm);
  return (
    <figure className="ch-card">
      <figcaption>
        <b>B · total deal value by step</b>
        <span className="ch-leg">crm.sqlite, sum(deals.amount)</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="ch-svg" role="img" aria-label="Deal value: $72.6M through step 5, then $34.7M from step 6 when 267 deal amounts were divided by 100.">
        {[0, 20, 40, 60, 80].map((m) => (
          <g key={m}>
            <line x1={L} x2={W - R} y1={y(m * 1e6)} y2={y(m * 1e6)} className="ch-grid" />
            <text x={L - 8} y={y(m * 1e6) + 4} textAnchor="end" className="ch-ax">${m}M</text>
          </g>
        ))}
        {B_DEALS.map((v, i) => (
          <g key={i}>
            <rect x={L + i * bw + 4} y={y(v)} width={bw - 8} height={y(0) - y(v)} fill={i >= 6 ? "#D7263D" : "#E07A1F"} opacity={i >= 6 ? 1 : 0.85} />
            <text x={L + i * bw + bw / 2} y={H - Bm + 18} textAnchor="middle" className="ch-ax">{i === 0 ? "base" : i}</text>
          </g>
        ))}
        <text x={W - R - 2} y={y(B_DEALS[6]) - 26} textAnchor="end" className="ch-lab bad">267 deals ÷100</text>
        <text x={W - R - 2} y={y(B_DEALS[6]) - 10} textAnchor="end" className="ch-lab mute">$72.6M → $34.7M</text>
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="ch-ax">agent step</text>
      </svg>
    </figure>
  );
}

const DIFF_ROWS: { tag: "lost" | "merged" | "changed"; where: string; key: string; what: string; before: string; after: string }[] = [
  { tag: "lost", where: "customers.csv", key: "id 63", what: "Carla Roberts", before: "carla.roberts@falconbridge.co", after: "deleted" },
  { tag: "lost", where: "customers.csv", key: "id 591", what: "Simona Evans", before: "simona.evans@brightline.ai", after: "deleted" },
  { tag: "merged", where: "customers.csv", key: "id 245", what: "Yuki Hill", before: "yuki.hill@pinebridge.com", after: "email still present" },
  { tag: "changed", where: "crm.sqlite › deals", key: "deal 14", what: "amount", before: "187,500", after: "1,875" },
  { tag: "changed", where: "config.json", key: "path", what: "dedupe.strategy", before: "exact", after: "fuzzy" },
];

export function DiffExample() {
  return (
    <figure className="ch-card ch-wide">
      <figcaption>
        <b>Typed diff · base → B@8</b>
        <span className="ch-leg">5 real rows from 399 removed (312 lost, 87 merged) and 267 deals ÷100</span>
      </figcaption>
      <div className="dx-wrap">
        <table className="dx">
          <thead>
            <tr><th /><th>File</th><th>Key</th><th>Field</th><th>Before → after</th></tr>
          </thead>
          <tbody>
            {DIFF_ROWS.map((r) => (
              <tr key={r.key + r.what} className={r.tag}>
                <td><b className={`tag ${r.tag === "lost" ? "lost" : r.tag === "merged" ? "merged" : "warn"}`}>{r.tag}</b></td>
                <td className="mono">{r.where}</td>
                <td className="mono">{r.key}</td>
                <td>{r.what}</td>
                <td className="mono">
                  <s>{r.before}</s> <span className="dx-arr">→</span> <b className={r.tag === "merged" ? "g" : "r"}>{r.after}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
