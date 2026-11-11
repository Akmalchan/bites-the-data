// A small "rewind" panel for the landing hero: the app's Overview network graph in miniature.
// Three lanes off base, B's step 4 is the first bad step, B is rolled back to step 3 (↺ head).
const LANES = [
  { id: "A", name: "Formatter (phones)", color: "#2f80ed", steps: 6, chip: "clean" },
  { id: "B", name: "Merger (fuzzy)", color: "#d9534f", steps: 8, chip: "broke at 4", bad: 4, head: 3 },
  { id: "C", name: "Enricher (web)", color: "#2aa876", steps: 8, chip: "clean" },
];

export function MiniGraph() {
  const x0 = 46;
  const dx = 30;
  const y = (i: number) => 64 + i * 46;
  const xOf = (s: number) => x0 + s * dx;
  return (
    <figure className="bd-mini" aria-label="Network graph: three agents branch off base; B's step 4 is the first bad step and B is rolled back to step 3">
      <div className="bd-mini-h bd-mono">
        <span className="bd-rec" /> rewind · B → step 3
      </div>
      <svg viewBox="0 0 340 200" className="bd-mini-svg">
        {Array.from({ length: 9 }, (_, s) => (
          <line key={s} x1={xOf(s)} x2={xOf(s)} y1={40} y2={182} className="bd-mini-grid" />
        ))}
        <circle cx={xOf(0)} cy={26} r={6} fill="#0d0d0c" />
        <text x={xOf(0) + 11} y={30} className="bd-mini-t">base</text>
        {LANES.map((l, i) => {
          const yy = y(i);
          const solid = l.head ?? l.steps;
          return (
            <g key={l.id}>
              <path d={`M${xOf(0)},26 C${xOf(0)},${yy} ${xOf(0)},${yy} ${xOf(0) + 22},${yy}`} stroke={l.color} strokeWidth={2.5} fill="none" />
              <line x1={xOf(0) + 22} y1={yy} x2={xOf(solid)} y2={yy} stroke={l.color} strokeWidth={2.5} />
              {l.head !== undefined && <line x1={xOf(l.head)} y1={yy} x2={xOf(l.steps)} y2={yy} stroke={l.color} strokeWidth={2} strokeDasharray="3 4" opacity={0.45} />}
              {Array.from({ length: l.steps }, (_, k) => {
                const s = k + 1;
                const isBad = l.bad === s;
                const undone = l.head !== undefined && s > l.head;
                return (
                  <rect
                    key={s}
                    x={xOf(s) - (isBad ? 7 : 5)}
                    y={yy - (isBad ? 7 : 5)}
                    width={isBad ? 14 : 10}
                    height={isBad ? 14 : 10}
                    fill={isBad ? "#fff" : undone ? "#fbfaf6" : l.color}
                    stroke={isBad ? "#ff2e88" : l.color}
                    strokeWidth={isBad ? 3 : 2}
                    opacity={undone && !isBad ? 0.5 : 1}
                    className={isBad ? "bd-mini-bad" : undefined}
                  />
                );
              })}
              {l.bad && <text x={xOf(l.bad)} y={yy - 14} textAnchor="middle" className="bd-mini-badt">first bad</text>}
              {l.head !== undefined && <text x={xOf(l.head)} y={yy + 22} textAnchor="middle" className="bd-mini-head">↺ head</text>}
              <text x={6} y={yy + 4} className="bd-mini-id" fill={l.color}>{l.id}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="bd-mini-f">
        <span><b>B</b> deleted 312 customers at step 4</span>
        <span className="bd-mini-ok">rolled back · 4,913 rows</span>
      </figcaption>
    </figure>
  );
}
