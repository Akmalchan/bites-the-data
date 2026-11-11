// The GEARGO team of 8 from a real scripted run. "Bad step" is what bisect finds.
type Rule = "ok" | "bad";
interface Row { id: string; name: string; did: string; result: string; rules: [Rule, Rule, Rule, Rule]; step?: string }
const ok: [Rule, Rule, Rule, Rule] = ["ok", "ok", "ok", "ok"];
const ROWS: Row[] = [
  { id: "G1", name: "Repricer (FX)", did: "Reprice imports for the new FX rate", result: "800 prices +2–5%", rules: ok },
  { id: "G2", name: "Catalog cleaner (fuzzy)", did: "Dedupe the catalog", result: "40 products removed", rules: ["bad", "ok", "ok", "ok"], step: "step 3" },
  { id: "G3", name: "Translator (web)", did: "ru/uz names, brand sites via Keenable", result: "translations added", rules: ok },
  { id: "G4", name: "Price normalizer (units)", did: "Normalize price units", result: "60 prices ÷100", rules: ["ok", "bad", "ok", "ok"], step: "step 4" },
  { id: "G5", name: "Fitment mapper (vehicles)", did: "Remap vehicle fitment", result: "fitment wiped on 25", rules: ["ok", "ok", "bad", "ok"], step: "step 5" },
  { id: "G6", name: "Stock sync (warehouse)", did: "Sync stock with the warehouse feed", result: "stock zeroed on 45", rules: ["ok", "ok", "ok", "bad"], step: "step 6" },
  { id: "G7", name: "SEO writer (descriptions)", did: "Rewrite thin descriptions", result: "300 descriptions rewritten", rules: ok },
  { id: "G8", name: "Promo planner (sales)", did: "Sale prices 5–15% off", result: "120 items on sale", rules: ok },
];
const RULES = ["No product removed", "Prices within ±20%", "Fitment set", "Stock not zeroed"];

const Dot = ({ v }: { v: Rule }) => <span className={`sdot ${v}`} title={v === "ok" ? "rule held" : "rule broke"} />;

export function SwarmTable() {
  return (
    <>
      <div className="sw-wrap">
        <table className="sw">
          <thead>
            <tr>
              <th>Agent</th>
              <th className="sw-did">Chore</th>
              <th>Result</th>
              {RULES.map((r) => <th key={r} className="c sw-rule">{r}</th>)}
              <th className="c sw-m">Rules</th>
              <th>Bad step</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const bad = r.rules.includes("bad");
              return (
                <tr key={r.id} className={bad ? "bad" : ""}>
                  <td><span className="mono sw-id">{r.id}</span> <b>{r.name}</b></td>
                  <td className="sw-did">{r.did}</td>
                  <td className={bad ? "r" : ""}>{r.result}</td>
                  {r.rules.map((v, i) => <td key={i} className="c sw-rule">{<Dot v={v} />}</td>)}
                  <td className="c sw-m"><span className="sw-dots">{r.rules.map((v, i) => <Dot key={i} v={v} />)}</span></td>
                  <td className="mono">{r.step ?? "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="sw-legend">Rules, left to right: {RULES.join(" · ")}</p>
      <p className="swarm-sum">
        8 agents ran. <span className="r">4 broke a rule.</span> Each was traced to its bad step and can be forked back from its last good one.
      </p>
    </>
  );
}
