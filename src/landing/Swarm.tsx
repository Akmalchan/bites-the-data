// Swarm × 8 results from a real scripted run (seed 42). "First bad step" is what bisect finds.
type Rule = "ok" | "bad";
const ROWS: { id: string; name: string; did: string; result: string; customers: Rule; deals: Rule; step?: string }[] = [
  { id: "S1", name: "Merger (exact)", did: "Merge exact duplicates only", result: "87 duplicates merged, none lost", customers: "ok", deals: "ok" },
  { id: "S2", name: "Formatter (phones)", did: "Phones to E.164, lowercase emails", result: "5,000 rows reformatted", customers: "ok", deals: "ok" },
  { id: "S3", name: "Merger (fuzzy)", did: "Exact plus fuzzy name merge", result: "312 customers deleted", customers: "bad", deals: "ok", step: "step 4" },
  { id: "S4", name: "Enricher (web)", did: "Fill countries, add region", result: "418 countries filled", customers: "ok", deals: "ok" },
  { id: "S5", name: "Formatter (emails)", did: "Lowercase emails only", result: "emails lowercased", customers: "ok", deals: "ok" },
  { id: "S6", name: "Merger (money)", did: "Exact merge, fix deal amounts", result: "267 deals ÷100 (−$37.8M)", customers: "ok", deals: "bad", step: "step 5" },
  { id: "S7", name: "Enricher (lite)", did: "Fill countries only", result: "418 countries filled", customers: "ok", deals: "ok" },
  { id: "S8", name: "Merger (aggressive)", did: "Every merge rule on", result: "312 deleted + 267 deals ÷100", customers: "bad", deals: "bad", step: "steps 4, 6" },
];

const Dot = ({ v }: { v: Rule }) => <span className={`sdot ${v}`} title={v === "ok" ? "rule held" : "rule broke"} />;

export function SwarmTable() {
  return (
    <>
      <div className="sw-wrap">
        <table className="sw">
          <thead>
            <tr>
              <th>Agent</th>
              <th className="sw-did">What it did</th>
              <th>Result</th>
              <th className="c">Customers rule</th>
              <th className="c">Deal value rule</th>
              <th>Bad step</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const bad = r.customers === "bad" || r.deals === "bad";
              return (
                <tr key={r.id} className={bad ? "bad" : ""}>
                  <td><span className="mono sw-id">{r.id}</span> <b>{r.name}</b></td>
                  <td className="sw-did">{r.did}</td>
                  <td className={bad ? "r" : ""}>{r.result}</td>
                  <td className="c"><Dot v={r.customers} /></td>
                  <td className="c"><Dot v={r.deals} /></td>
                  <td className="mono">{r.step ?? "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="swarm-sum">
        8 agents ran. <span className="r">3 broke a rule.</span> Each was traced to its bad step.
      </p>
    </>
  );
}
