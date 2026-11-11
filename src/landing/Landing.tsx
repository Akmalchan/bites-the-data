import { useEffect, useRef, useState, type ReactNode } from "react";
import { HeroImage, useHeroImage } from "./HeroImage.tsx";
import { Logo } from "../icons.tsx";
import { PrSection } from "./PrSection.tsx";
import { DealsChart, DiffExample, RowsChart } from "./Charts.tsx";
import { SwarmTable } from "./Swarm.tsx";
import "./landing.css";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------------ hero title: glitch + periodic VHS rewind */

function GlitchTitle() {
  // One subtle effect: every ~8 s a 350 ms RGB split with a few thin scanlines passing, then clean.
  const [glitch, setGlitch] = useState(false);
  useEffect(() => {
    if (reduced()) return;
    let t: ReturnType<typeof setTimeout>;
    const id = setInterval(() => {
      setGlitch(true);
      t = setTimeout(() => setGlitch(false), 360);
    }, 8000);
    return () => {
      clearInterval(id);
      clearTimeout(t);
    };
  }, []);
  return (
    <div className={`gt ${glitch ? "on" : ""}`} data-testid="glitch-title">
      <div className="gt-hud" aria-hidden>REW ◀◀ 00:03</div>
      <h1 className="gt-title" aria-label="Bites the Data.">
        <span className="gt-line" data-text="Bites">Bites</span>
        <span className="gt-line" data-text="the Data.">
          the Data<span className="gt-dot">.</span>
        </span>
      </h1>
      <div className="gt-scan" aria-hidden />
    </div>
  );
}

/* ------------------------------------------------------------------ animated mini network (hero fallback) */

const LANES = [
  { id: "A", color: "#2F7DD1", steps: 6 },
  { id: "B", color: "#E07A1F", steps: 8, bad: 4, head: 3 },
  { id: "C", color: "#0F9E8E", steps: 8 },
];

function LiveGraph() {
  // t 0..8: dots appear; 9..10: B@4 flagged; 11..15: rewound to step 3; loops
  const [t, setT] = useState(() => (reduced() ? 13 : 0));
  useEffect(() => {
    if (reduced()) return;
    const id = setInterval(() => setT((x) => (x + 1) % 16), 520);
    return () => clearInterval(id);
  }, []);
  const shown = Math.min(8, t);
  const flagged = t >= 9;
  const rewound = t >= 11;
  const x = (s: number) => 40 + s * 34;
  const y = (i: number) => 60 + i * 52;
  return (
    <figure className="lg-card" aria-label="Animated network: three agents branch from base; B breaks at step 4 and is rewound to step 3">
      <div className={`lg-h ${rewound ? "rew" : ""}`}>
        {rewound ? "REW ◀◀ B → STEP 3" : flagged ? "B BROKE A RULE AT STEP 4" : `PLAY ▶ STEP ${shown}/8`}
      </div>
      <svg viewBox="0 0 340 200" className="lg-svg">
        {Array.from({ length: 9 }, (_, s) => (
          <line key={s} x1={x(s)} x2={x(s)} y1={36} y2={186} className="lg-grid" />
        ))}
        <circle cx={x(0)} cy={22} r={6} fill="#0D0F14" />
        <text x={x(0) + 11} y={26} className="lg-t">base</text>
        {LANES.map((l, i) => {
          const yy = y(i);
          const last = Math.min(l.steps, shown);
          const end = l.head !== undefined && rewound ? l.head : last;
          return (
            <g key={l.id}>
              <path d={`M${x(0)},28 C${x(0)},${yy} ${x(0)},${yy} ${x(0) + 20},${yy}`} stroke={l.color} strokeWidth={2.5} fill="none" />
              {end > 0 && <line x1={x(0) + 20} y1={yy} x2={x(end)} y2={yy} stroke={l.color} strokeWidth={2.5} />}
              {l.head !== undefined && rewound && last > l.head && <line x1={x(l.head)} y1={yy} x2={x(last)} y2={yy} stroke={l.color} strokeWidth={2} strokeDasharray="3 4" opacity={0.4} />}
              {Array.from({ length: last }, (_, k) => {
                const s = k + 1;
                const bad = flagged && l.bad === s;
                const undone = rewound && l.head !== undefined && s > l.head;
                return (
                  <g key={s}>
                    {bad && <circle cx={x(s)} cy={yy} r={13} className="lg-halo" />}
                    <circle cx={x(s)} cy={yy} r={bad ? 7 : 5.5} fill={bad || undone ? "#fff" : l.color} stroke={bad ? "#D7263D" : l.color} strokeWidth={bad ? 3 : 2} opacity={undone && !bad ? 0.45 : 1} />
                  </g>
                );
              })}
              {l.head !== undefined && rewound && <text x={x(l.head)} y={yy + 22} textAnchor="middle" className="lg-head">↺ HEAD</text>}
              <text x={8} y={yy + 4} className="lg-id" fill={l.color}>{l.id}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/* ------------------------------------------------------------------ count-up numbers */

function CountUp({ to, decimals = 0, prefix = "", suffix = "" }: { to: number; decimals?: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(() => (reduced() ? to : 0));
  useEffect(() => {
    if (reduced() || !ref.current) return;
    const el = ref.current;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / 1100);
        setV(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to]);
  return (
    <span ref={ref} className="num">
      {prefix}
      {v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

const NUMBERS: { big: ReactNode; label: string; ctx: string }[] = [
  { big: "Every step", label: "saved as an Archil checkpoint", ctx: "~0.2 s each, any disk size" },
  { big: <><span className="num-math">⌈log₂ n⌉</span><small> checks</small></>, label: "to find the step that broke a rule", ctx: "8 steps → 3 checks" },
  { big: "< 0.5 s", label: "to roll an agent back", ctx: "one Archil branch" },
  { big: <>0<small> sandboxes</small></>, label: "one serverless exec per agent step", ctx: "about $0.05 per 1,000 steps" },
];

/* ------------------------------------------------------------------ bisect animation */

// G4 Price normalizer, rule "prices within ±20%": the real probe sequence.
const PROBES = [
  { s: 5, ok: false },
  { s: 0, ok: true },
  { s: 2, ok: true },
  { s: 3, ok: true },
  { s: 4, ok: false },
];
const BIS_N = 5;

function BisectAnim() {
  const k = PROBES.length; // static: the full probe sequence
  const done = k >= PROBES.length;
  const seen = PROBES.slice(0, k);
  return (
    <div className="bis">
      <div className="bis-lbl mono">steps of G4 (✓ rule held · ✗ rule broke · blank = not checked)</div>
      <div className="bis-row" style={{ gridTemplateColumns: `repeat(${BIS_N + 1}, 1fr)` }}>
        {Array.from({ length: BIS_N + 1 }, (_, s) => {
          const p = seen.find((x) => x.s === s);
          return (
            <div key={s} className={`bis-cell ${p ? (p.ok ? "ok" : "bad") : ""} ${done && s === 4 ? "first" : ""}`}>
              <span>{s === 0 ? "base" : s}</span>
              <i>{p ? (p.ok ? "✓" : "✗") : ""}</i>
            </div>
          );
        })}
      </div>
      <div className="bis-log mono">
        checked: 5 ✗, base ✓, then {seen.slice(2).map((p) => `${p.s} ${p.ok ? "✓" : "✗"}`).join(", ")}
        {done && <b> ⇒ step 4 broke it</b>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

function Block({ title, children, note, lead }: { title: string; children: ReactNode; note?: string; lead?: string }) {
  return (
    <div className="blk">
      <h3>{title}</h3>
      {lead && <p className="blk-lead">{lead}</p>}
      <div className="blk-body">{children}</div>
      {note && <p className="blk-note">{note}</p>}
    </div>
  );
}

const V = ({ children }: { children: ReactNode }) => <var>{children}</var>;

export function Landing() {
  const hero = useHeroImage();
  useEffect(() => {
    document.body.style.background = "#F5F4F0";
  }, []);
  return (
    <div className="bd">
      <header className="bd-nav">
        <a className="bd-brand" href="/">
          <Logo size={26} animated />
        </a>
        <nav>
          <a href="#pr">GitHub</a>
          <a href="#how">How it works</a>
          <a className="bd-navcta" href="/app">
            Open the app →
          </a>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-l">
          <div className="badge mono">NEON FOR AGENT DATA · ON ARCHIL</div>
          <GlitchTitle />
          <p className="hero-tag">Track Changes for AI agents' data.</p>
          <a className="cta" href="/app" data-testid="landing-cta">
            Open the app <span className="arrow">→</span>
          </a>
        </div>
        <div className="hero-r">{hero ? <HeroImage src={hero} /> : <LiveGraph />}</div>
      </section>

      <section className="nums" aria-label="Numbers from tonight's runs">
        {NUMBERS.map((n) => (
          <div key={n.label}>
            <span className="num-row">{n.big}</span>
            <span className="lbl">{n.label}</span>
            <span className="ctx">{n.ctx}</span>
          </div>
        ))}
      </section>

      <section className="sec">
        <div className="kick mono">The problem</div>
        <h2>Git can't read your data. We can.</h2>
        <div className="ex-lbl mono">Example: GEARGO, a live e-commerce catalog · PR #106</div>
        <div className="terms">
          <div className="term-col">
            <div className="term-lbl">What git tells you</div>
            <div className="term term-git">
              <div className="term-h mono">$ git diff --stat main...pr106</div>
              <pre className="git-out">
                products.csv                | +44 −46{"\n"}rax-motors-brake-pads.json  |  +9 −9{"\n"}translations/products.json   |  +1 −1
              </pre>
            </div>
            <p className="term-cap">Line counts. Nothing about which products, prices or vehicles.</p>
          </div>
          <div className="term-col">
            <div className="term-lbl us">What Bites the Data tells you</div>
            <div className="term term-us">
              <div className="term-h mono">$ bites pr-check GEARGO#106</div>
              <table className="mini-t">
                <thead>
                  <tr><th /><th>product</th><th>change</th></tr>
                </thead>
                <tbody>
                  <tr className="rm"><td><b className="tag lost">removed</b></td><td>tesla-model-y-frunk-organizer</td><td>row deleted</td></tr>
                  <tr className="ch"><td><b className="tag warn">÷100</b></td><td>byd-song-plus-led-headlight-assembly</td><td><s>2,800,000</s> → <b>29,130</b></td></tr>
                  <tr className="rm"><td><b className="tag lost">fitment</b></td><td>tesla-model-3-y-aluminum-pedal-set</td><td>vehicles → <b>empty</b></td></tr>
                  <tr className="ch"><td><b className="tag warn">stock</b></td><td>li-auto-l8-rear-seat-tablet-holder</td><td><s>26</s> → <b>0</b></td></tr>
                </tbody>
              </table>
              <div className="term-sum">2 products removed · 4 prices ÷100 · fitment lost on 1 · 3 stock → 0</div>
            </div>
            <p className="term-cap">Which products were removed, which prices crashed, which vehicles lost fitment.</p>
          </div>
        </div>
      </section>

      <PrSection />

      <section className="sec" id="watch">
        <div className="kick mono">Real run, drawn to scale</div>
        <h2>Watch it happen.</h2>
        <div className="ch-grid2">
          <RowsChart />
          <DealsChart />
        </div>
        <DiffExample />
      </section>

      <section className="sec" id="how">
        <div className="kick mono">How it works</div>
        <h2>Save. Compare. Undo.</h2>
        <div className="steps3">
          <div className="st3">
            <div className="st3-n">1</div>
            <h3>Save every step</h3>
            <p>Each agent step becomes an Archil checkpoint of the whole disk, in about 0.2 s.</p>
            <div className="st3-vis" aria-hidden>
              <div className="cp-row">
                {["base", "1", "2", "3", "4", "5"].map((x) => (
                  <span key={x} className="cp"><i />{x}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="st3">
            <div className="st3-n">2</div>
            <h3>Compare any two</h3>
            <p>A typed diff: rows and cells for CSV, tables for SQLite, paths for JSON.</p>
            <div className="st3-vis mono" aria-hidden>
              <div className="cmp-line"><b className="tag lost">removed</b> tesla-model-y-frunk-organizer</div>
              <div className="cmp-line"><b className="tag warn">÷100</b> price <s>2,800,000</s> → 29,130</div>
              <div className="cmp-line"><b className="tag merged">json</b> sellers[sku=GG-0057].priceUzs 410,000 → 425,000</div>
            </div>
          </div>
          <div className="st3">
            <div className="st3-n">3</div>
            <h3>Find it and undo it</h3>
            <p>Bisect finds the step that broke a rule. Roll back with one Archil branch.</p>
            <div className="st3-vis" aria-hidden>
              <div className="mini-bis">
                {[0, 1, 2, 3, 4, 5].map((k) => (
                  <span key={k} className={k <= 3 ? "ok" : "bad"}>{k === 0 ? "base" : k}</span>
                ))}
              </div>
              <div className="mono st3-small">G4: first bad step 4 · ↺ fork from step 3</div>
            </div>
          </div>
        </div>
        <h3 className="uth">Under the hood</h3>

        <div className="blks">
          <Block title="Checkpoint manifest" lead="Fingerprint every file at every checkpoint; only files whose fingerprint changed are compared." note="Only changed files are read, via S3 GetObject with versionId.">
            <div className="eq"><V>M</V>(<V>t</V>) = {"{"} <V>p</V> ↦ sha256(<V>file</V><sub>p</sub>) {"}"}</div>
            <div className="eq">Δ(<V>t</V>₁, <V>t</V>₂) = {"{"} <V>p</V> : <V>M</V>(<V>t</V>₁)[<V>p</V>] ≠ <V>M</V>(<V>t</V>₂)[<V>p</V>] {"}"}</div>
          </Block>
          <Block title="Keyed row diff" lead="Match products by SKU: a missing SKU is a removed product, a changed cell is a before → after." note="Key auto-detected (id-like column), or set per file: sku for products.csv. Re-sorting counts as zero changes.">
            <div className="eq">removed = <V>K</V>₁ ∖ <V>K</V>₂ &nbsp;·&nbsp; added = <V>K</V>₂ ∖ <V>K</V>₁</div>
            <div className="eq">changed = {"{"} <V>k</V> ∈ <V>K</V>₁ ∩ <V>K</V>₂ : <V>r</V>₁(<V>k</V>) ≠ <V>r</V>₂(<V>k</V>) {"}"}</div>
            <div className="eq big">G2: 2,000 → 1,960 = <span className="r">40 SKUs removed</span>, 0 changed</div>
          </Block>
          <Block title="Invariants" lead="Plain rules about your data, checked at any saved step. GEARGO has four." note="Prices, fitment and stock are measured against the base catalog, by SKU.">
            <div className="eq small-rule">No product removed: rows(products.csv) ≥ 2,000</div>
            <div className="eq small-rule">Prices within ±20%: max |<V>p</V> / <V>p</V>₀ − 1| ≤ 0.2</div>
            <div className="eq small-rule">Fitment set unless universal fit: unfit = 0</div>
            <div className="eq small-rule">Stock not zeroed by a catalog agent: zeroed = 0</div>
          </Block>
          <Block title="Bisect" lead="Check both ends, then the middle step, and keep the half that broke. 8 steps need only 3 checks." note="G4 has 5 steps → ⌈log₂ 5⌉ = 3 checks after the endpoints.">
            <BisectAnim />
          </Block>
          <Block title="Time-travel query" lead="Follow one product across every checkpoint and see exactly when it vanished." note="Scan checkpoints for a key and report where it disappears. Reads are cached by hash.">
            <div className="eq">first = min {"{"} <V>i</V> : <V>k</V> ∉ <V>K</V>(<V>c</V><sub>i</sub>) {"}"}</div>
            <div className="eq small mono">tesla-model-y-frunk-organizer (G2): c₀ … c₂ ✓ → c₃ ✗</div>
          </Block>
          <Block title="Cost per run" lead="One small serverless call per step and no sandboxes, so a whole rehearsal costs a fraction of a cent." note="Measured on Archil: 8 agents, 45 checkpoints on 8 disks, run + fix + rollback.">
            <div className="eq">GEARGO rehearsal: 55 exec calls · 2 branches · 0 sandboxes</div>
            <div className="eq">55 × $0.05 / 1,000 ≈ <b>$0.0028</b></div>
          </Block>
        </div>
      </section>

      <section className="sec">
        <div className="kick mono">The GEARGO team</div>
        <h2>8 agents, one review.</h2>
        <SwarmTable />
      </section>

      <section className="sec built">
        <div className="kick mono">Built on</div>
        <div className="built-row">
          <div><b>Archil</b><span>disks, checkpoints, branches and serverless exec</span></div>
          <div><b>Keenable</b><span>web search for the Translator, with source URLs</span></div>
          <div><b>GitHub</b><span>a data-impact comment on every pull request</span></div>
        </div>
      </section>

      <section className="foot-cta">
        <h2>Rewind your agent's data.</h2>
        <a className="cta" href="/app">
          Open the app <span className="arrow">→</span>
        </a>
      </section>
      <footer className="bd-foot mono">Bites the Data · built at Agents Need Solid Ground<br />Example data: 55 real GEARGO products + 1,945 generated in the same format.</footer>
    </div>
  );
}
