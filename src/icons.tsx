import { useEffect, useState } from "react";
export function DeltaLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
      <path d="M16 4 29 27H3Z" fill="none" stroke="var(--accent)" strokeWidth="3.2" strokeLinejoin="round" />
      <path d="M16 13 22 23H10Z" fill="var(--accent)" opacity="0.35" />
    </svg>
  );
}

export function WarnIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label="warning" style={{ flex: "none", marginTop: 1 }}>
      <path d="M8 1.5 15 14H1Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 6v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r="0.9" fill="currentColor" />
    </svg>
  );
}

/* "Bites the Data" mark: two touching rewind triangles (◀◀) in VHS blue on a 10x8 pixel grid,
   with a 3-column "render" trail of dithered pixels fading out to the right. */
const TRI: [number, number][] = [];
// two touching left-pointing triangles, 3 columns each (heights 2, 4, 6), centered in rows 1..6
for (const x0 of [0, 3]) for (let c = 0; c < 3; c++) for (let r = 3 - c; r <= 4 + c; r++) TRI.push([x0 + c, r]);
const TRAILS: [number, number, number][][] = [
  // [col, row, opacity]: 3 columns fading 100% -> 60% -> 25%; the landing re-dithers between variants
  [[7, 1, 1], [7, 3, 1], [7, 4, 1], [7, 6, 1], [8, 2, 0.6], [8, 5, 0.6], [9, 3, 0.25], [9, 4, 0.25]],
  [[7, 2, 1], [7, 3, 1], [7, 4, 1], [7, 5, 1], [8, 1, 0.6], [8, 6, 0.6], [9, 2, 0.25], [9, 5, 0.25]],
  [[7, 1, 1], [7, 2, 1], [7, 5, 1], [7, 6, 1], [8, 3, 0.6], [8, 4, 0.6], [9, 1, 0.25], [9, 6, 0.25]],
];

export function LogoMark({ size = 24, trail = 3, variant = 0 }: { size?: number; trail?: 1 | 3; variant?: number }) {
  const t = TRAILS[variant % TRAILS.length].filter(([c]) => c < 7 + trail);
  return (
    <svg width={size} height={(size * 8) / 10} viewBox="0 0 10 8" shapeRendering="crispEdges" aria-hidden className="logomark">
      <path fill="#1A2BFF" d={TRI.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("")} />
      {t.map(([x, y, o]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#1A2BFF" opacity={o} />
      ))}
    </svg>
  );
}

/** Mark + wordmark in the display face (header and landing nav). */
export function Logo({ size = 24, animated = false }: { size?: number; animated?: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!animated || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setV((x) => x + 1), 2800);
    return () => clearInterval(id);
  }, [animated]);
  return (
    <span className="logo">
      <LogoMark size={size} variant={v} />
      <span className="logo-word">Bites the Data</span>
    </span>
  );
}
