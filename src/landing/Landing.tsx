import { useEffect, useRef, useState, type ReactNode } from "react";
import { HeroImage, useHeroImage } from "./HeroImage.tsx";
import { Logo } from "../icons.tsx";
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

const NUMBERS: { to: number; d?: number; pre?: string; suf?: string; label: string; hot?: boolean }[] = [
  { to: 312, label: "lost customers caught", hot: true },
  { to: 3, label: "checks to find the bad step" },
  { to: 0, label: "sandboxes" },
  { to: 28, pre: "~", label: "exec calls per run" },
  { to: 0.12, d: 2, suf: " s", label: "rollback via Archil branch" },
  { to: 25, label: "Keenable web lookups" },
];

/* ------------------------------------------------------------------ bisect animation */

const PROBES = [
  { s: 8, ok: false },
  { s: 0, ok: true },
  { s: 4, ok: false },
  { s: 2, ok: true },
  { s: 3, ok: true },
];

function BisectAnim() {
  const k = PROBES.length; // static: the full probe sequence
  const done = k >= PROBES.length;
  const seen = PROBES.slice(0, k);
  return (
    <div className="bis">
      <div className="bis-row">
        {Array.from({ length: 9 }, (_, s) => {
          const p = seen.find((x) => x.s === s);
          return (
            <div key={s} className={`bis-cell ${p ? (p.ok ? "ok" : "bad") : ""} ${done && s === 4 ? "first" : ""}`}>
              <span>{s === 0 ? "B" : s}</span>
              <i>{p ? (p.ok ? "✓" : "✗") : ""}</i>
            </div>
          );
        })}
      </div>
      <div className="bis-log mono">
        {k <= 2 ? "endpoints: 8 ✗ · base ✓" : seen.slice(2).map((p) => `${p.s} ${p.ok ? "✓" : "✗"}`).join("  →  ")}
        {done && <b>  ⇒ step 4</b>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

function Block({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <div className="blk">
      <h3>{title}</h3>
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
          <div key={n.label} className={n.hot ? "hot" : ""}>
            <CountUp to={n.to} decimals={n.d} prefix={n.pre} suffix={n.suf} />
            <span className="lbl">{n.label}</span>
          </div>
        ))}
      </section>

      <section className="sec">
        <div className="kick mono">The problem</div>
        <h2>Same agent run. Two answers.</h2>
        <div className="terms">
          <div className="term term-git">
            <div className="term-h mono">$ git diff --stat</div>
            <pre className="git-out">
              customers.csv | +4,504 −4,903{"\n"}Binary files a/crm.sqlite and b/crm.sqlite differ
            </pre>
          </div>
          <div className="term term-us">
            <div className="term-h mono">$ bites diff base B@8</div>
            <table className="mini-t">
              <thead>
                <tr><th /><th>id</th><th>name</th><th>email</th></tr>
              </thead>
              <tbody>
                <tr className="rm"><td><b className="tag lost">lost</b></td><td>63</td><td>Carla Roberts</td><td>carla.roberts@…</td></tr>
                <tr className="rm"><td><b className="tag lost">lost</b></td><td>591</td><td>Simona Evans</td><td>simona.evans@…</td></tr>
                <tr><td><b className="tag merged">merged</b></td><td>245</td><td>Yuki Hill</td><td>yuki.hill@…</td></tr>
                <tr className="ch"><td><b className="tag warn">÷100</b></td><td>deal 8</td><td colSpan={2}><s>83,750</s> → <b>837.5</b></td></tr>
              </tbody>
            </table>
            <div className="term-sum">312 customers deleted · 267 deals ÷100</div>
          </div>
        </div>
      </section>

      <section className="sec" id="how">
        <div className="kick mono">How it works</div>
        <h2>Checkpoints in, answers out.</h2>
        <ol className="pipe">
          {[
            ["agent step", "one tool call"],
            ["disk.exec", "zero sandboxes"],
            ["checkpoint", "archil checkpoints create"],
            ["manifest", "sha256 per file"],
            ["typed diff", "rows · cells · paths"],
            ["invariants", "rules on data"],
            ["bisect", "⌈log₂ n⌉ checks"],
            ["roll back", "createBranch"],
          ].map(([a, b], i) => (
            <li key={a} className="pipe-n">
              <span className="pipe-i mono">{String(i + 1).padStart(2, "0")}</span>
              <b>{a}</b>
              <span className="mono">{b}</span>
            </li>
          ))}
        </ol>

        <div className="blks">
          <Block title="Checkpoint manifest" note="Only changed files are read, via S3 GetObject with versionId.">
            <div className="eq"><V>M</V>(<V>t</V>) = {"{"} <V>p</V> ↦ sha256(<V>file</V><sub>p</sub>) {"}"}</div>
            <div className="eq">Δ(<V>t</V>₁, <V>t</V>₂) = {"{"} <V>p</V> : <V>M</V>(<V>t</V>₁)[<V>p</V>] ≠ <V>M</V>(<V>t</V>₂)[<V>p</V>] {"}"}</div>
          </Block>
          <Block title="Keyed row diff" note="A removed row is merged if its email survives, otherwise lost.">
            <div className="eq">removed = <V>K</V>₁ ∖ <V>K</V>₂ &nbsp;·&nbsp; added = <V>K</V>₂ ∖ <V>K</V>₁</div>
            <div className="eq">changed = {"{"} <V>k</V> ∈ <V>K</V>₁ ∩ <V>K</V>₂ : <V>r</V>₁(<V>k</V>) ≠ <V>r</V>₂(<V>k</V>) {"}"}</div>
            <div className="eq big">399 removed = <span className="g">87 merged</span> + <span className="r">312 lost</span></div>
          </Block>
          <Block title="Invariants" note="Predicates over a whole world, checked at any checkpoint.">
            <div className="eq">rows(customers.csv) ≥ 4,913</div>
            <div className="eq">| Σ deals.amount − Σ₀ | ≤ ε · Σ₀</div>
          </Block>
          <Block title="Bisect" note="n = 8 steps → ⌈log₂ 8⌉ = 3 checks.">
            <BisectAnim />
          </Block>
          <Block title="Time-travel query" note="Scan checkpoints for a key and report where it disappears. Reads are cached by hash.">
            <div className="eq">first = min {"{"} <V>i</V> : <V>k</V> ∉ <V>K</V>(<V>c</V><sub>i</sub>) {"}"}</div>
            <div className="eq small mono">Carla Roberts: c₀ … c₃ ✓ → c₄ ✗</div>
          </Block>
          <Block title="Cost per run" note="One batched exec per step, no sandbox compute.">
            <div className="eq">calls ≈ Σ<sub>agents</sub> (steps + 1) + 1 ≈ 28</div>
            <div className="eq">28 × $0.05 / 1,000 ≈ <b>$0.0014</b></div>
          </Block>
        </div>
      </section>

      <section className="sec">
        <div className="kick mono">Swarm</div>
        <h2>8 agents, one review.</h2>
        <div className="tiles8">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className={`t8 ${[2, 5, 7].includes(i) ? "bad" : "ok"}`}>
              <span className="mono">S{i + 1}</span>
              <b>{[2, 5, 7].includes(i) ? "rogue" : "clean"}</b>
            </div>
          ))}
        </div>
        <div className="swarm-sum">
          <span className="g">5 clean</span> · <span className="r">3 rogue</span>
        </div>
      </section>

      <section className="sec built">
        <div className="kick mono">Built on</div>
        <div className="built-row">
          <div><b>Archil</b><span>disks, checkpoints, branches and serverless exec</span></div>
          <div><b>Keenable</b><span>web search for the Enricher, with source URLs</span></div>
        </div>
      </section>

      <section className="foot-cta">
        <h2>Rewind your agent's data.</h2>
        <a className="cta" href="/app">
          Open the app <span className="arrow">→</span>
        </a>
      </section>
      <footer className="bd-foot mono">Bites the Data · built at Agents Need Solid Ground</footer>
    </div>
  );
}
