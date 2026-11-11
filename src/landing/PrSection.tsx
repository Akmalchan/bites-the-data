// "On every pull request": an HTML replica of the real Bites the Data comment on
import type { ReactNode } from "react";
// Akmalchan/GEARGO#106 (data from prcheck/reports/pr106.json), plus the flow behind it.

const RED = "🔴";
const YEL = "🟡";
const GRN = "🟢";

const FILES = [
  { dot: RED, file: "products.csv", rows: "55 → 53", changes: "44 changed · 2 removed", git: "+44 −46" },
  { dot: GRN, file: "sellers/rax-motors-brake-pads.json", rows: "–", changes: "9 values", git: "+9 −9" },
  { dot: GRN, file: "translations/products.json", rows: "–", changes: "1 value", git: "+1 −1" },
];

const GROUPS: { title: string; rows: { dot: string; item: string; change: ReactNode }[] }[] = [
  {
    title: "Prices · 4",
    rows: [
      { dot: RED, item: "byd-song-plus-led-headlight-assembly", change: "2,800,000 → 29,130 (÷100)" },
      { dot: RED, item: "xpeng-g6-wireless-carplay-screen", change: "1,650,000 → 16,850 (÷100)" },
      { dot: RED, item: "xpeng-x9-luxury-floor-mat-set", change: "1,250,000 → 13,060 (÷100)" },
      { dot: RED, item: "universal-battery-booster-pack", change: "980,000 → 10,190 (÷100)" },
    ],
  },
  {
    title: "Removed products · 2",
    rows: [
      { dot: RED, item: "tesla-model-y-frunk-organizer", change: "removed" },
      { dot: RED, item: "byd-han-ambient-light-kit", change: "removed" },
    ],
  },
  { title: "Fitment · 1", rows: [{ dot: RED, item: "tesla-model-3-y-aluminum-pedal-set", change: <>fitment <code>tesla-model-3|tesla-model-y</code> → empty</> }] },
  {
    title: "Stock · 3",
    rows: [
      { dot: YEL, item: "li-auto-l8-rear-seat-tablet-holder", change: "stock 26 → 0" },
      { dot: YEL, item: "xpeng-g6-cargo-liner", change: "stock 20 → 0" },
      { dot: YEL, item: "byd-song-plus-tpe-floor-mat-set", change: "stock 24 → 0" },
    ],
  },
];

function GhComment() {
  return (
    <div className="gh" aria-label="Bites the Data comment on GitHub pull request 106">
      <div className="gh-av" aria-hidden>A</div>
      <div className="gh-card">
        <div className="gh-hd">
          <b>Akmalchan</b> commented <span>· Akmalchan/GEARGO#106</span>
        </div>
        <div className="gh-body">
          <h3>Bites the Data · data impact</h3>
          <p>
            {RED} <b>Review needed</b> — 10 issues in 1 of 3 data files
          </p>
          <div className="gh-tw">
            <table>
              <thead>
                <tr><th /><th>File</th><th>Rows</th><th>Changes</th><th>git shows</th></tr>
              </thead>
              <tbody>
                {FILES.map((f) => (
                  <tr key={f.file}><td className="c">{f.dot}</td><td>{f.file}</td><td>{f.rows}</td><td>{f.changes}</td><td>{f.git}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="gh-tw">
            <table>
              <thead>
                <tr><th /><th>Issue</th><th>Before → after</th></tr>
              </thead>
              <tbody>
                {GROUPS.flatMap((g) => [
                  <tr key={g.title}><td /><td><b>{g.title}</b></td><td /></tr>,
                  ...g.rows.map((r) => (
                    <tr key={r.item}><td className="c">{r.dot}</td><td><code>{r.item}</code></td><td>{r.change}</td></tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
          <p>{GRN} 40 other price changes look routine (+2.2% to +5.3%)</p>
          <details>
            <summary>All data changes (60)</summary>
            <p className="gh-sub">48 cell changes, 2 removed rows, 10 JSON values.</p>
          </details>
          <p className="gh-sub">
            Archil: checkpoints <code>pr106-base</code> → <code>pr106-head</code> on disk <code>bites-geargo</code> · branch <code>pr106</code> · 2 exec calls · sha256 verified
            <br />
            <a>Open full diff →</a> · <code>39de22a</code> → <code>902c434</code> · served by the reviewer's Bites the Data instance (localhost)
          </p>
        </div>
      </div>
    </div>
  );
}

const FLOW = [
  { t: "Agent opens a PR", s: "agent/bulk-price-sync-demo → main" },
  { t: "Base and head saved on Archil", s: "checkpoints pr106-base, pr106-head · branch pr106" },
  { t: "Typed diff + rules", s: "rows keyed by sku · prices, removals, fitment, stock" },
  { t: "Comment on the PR", s: "one comment, updated in place on every push" },
];

export function PrSection() {
  return (
    <section className="sec" id="pr">
      <div className="kick mono">GitHub</div>
      <h2>On every pull request.</h2>
      <div className="pr-grid">
        <GhComment />
        <div className="pr-side">
          <ol className="flow">
            {FLOW.map((f, i) => (
              <li key={f.t}>
                <span className="flow-n">{i + 1}</span>
                <div>
                  <b>{f.t}</b>
                  <span className="mono">{f.s}</span>
                </div>
              </li>
            ))}
          </ol>
          <p className="pr-cap">
            Real PR on GEARGO, a live e-commerce store. GitHub shows <b className="mono">+44 −46 lines</b>. We show <b className="r">4 prices crashed 99%</b> and{" "}
            <b className="r">2 products deleted</b>.
          </p>
        </div>
      </div>
    </section>
  );
}
