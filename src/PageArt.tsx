// Small original pixel illustrations (16x16 grid, crisp) for the rail popovers and page headers.
// Palette: VHS blue, ink, and red as the single semantic accent.
import type { ClassicPage } from "./Dashboard.tsx";

const BLUE = "#1A2BFF";
const INK = "#0D0F14";
const RED = "#D7263D";
type Px = [number, number, string];

function rect(out: Px[], x: number, y: number, w: number, h: number, c: string) {
  for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) out.push([i, j, c]);
}
function ring(out: Px[], cx: number, cy: number, r: number, c: string) {
  const seen = new Set<string>();
  for (let a = 0; a < 360; a += 4) {
    const x = Math.round(cx + r * Math.cos((a * Math.PI) / 180));
    const y = Math.round(cy + r * Math.sin((a * Math.PI) / 180));
    const k = `${x},${y}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push([x, y, c]);
    }
  }
}

const ART: Record<ClassicPage, () => Px[]> = {
  dashboard: () => {
    const o: Px[] = [];
    rect(o, 0, 1, 16, 1, INK); rect(o, 0, 10, 16, 1, INK); rect(o, 0, 1, 1, 10, INK); rect(o, 15, 1, 1, 10, INK);
    rect(o, 2, 3, 3, 4, BLUE); rect(o, 6, 3, 3, 4, BLUE); rect(o, 10, 3, 3, 4, RED);
    rect(o, 2, 8, 9, 1, BLUE);
    rect(o, 6, 11, 4, 2, INK); rect(o, 4, 13, 8, 1, INK);
    return o;
  },
  network: () => {
    const o: Px[] = [];
    rect(o, 1, 1, 2, 2, INK);
    rect(o, 2, 3, 1, 10, INK);
    for (const [i, y] of [4, 8, 12].entries()) {
      rect(o, 3, y, 12, 1, BLUE);
      for (const x of [5, 9, 13]) rect(o, x - 1, y - 1, 2, 2, i === 1 && x === 9 ? RED : BLUE);
    }
    return o;
  },
  bisect: () => {
    const o: Px[] = [];
    for (let k = 0; k < 8; k++) rect(o, k * 2, 13, 1, 2, k === 3 ? RED : BLUE);
    ring(o, 6, 6, 4, INK);
    rect(o, 9, 9, 1, 1, INK); rect(o, 10, 10, 1, 1, INK); rect(o, 11, 11, 1, 1, INK); rect(o, 10, 11, 1, 1, INK);
    rect(o, 6, 4, 1, 3, BLUE); rect(o, 5, 5, 3, 1, BLUE);
    return o;
  },
  history: () => {
    const o: Px[] = [];
    ring(o, 9, 9, 6, INK);
    rect(o, 9, 5, 1, 4, BLUE); rect(o, 9, 9, 3, 1, BLUE);
    // rewind arrows (◀◀) top-left
    for (const x0 of [0, 3]) o.push([x0, 2, BLUE], [x0 + 1, 1, BLUE], [x0 + 1, 2, BLUE], [x0 + 1, 3, BLUE], [x0 + 2, 0, BLUE], [x0 + 2, 1, BLUE], [x0 + 2, 2, BLUE], [x0 + 2, 3, BLUE], [x0 + 2, 4, BLUE]);
    return o;
  },
  swarm: () => {
    const o: Px[] = [];
    let i = 0;
    for (const y of [3, 8]) for (const x of [0, 4, 8, 12]) {
      rect(o, x, y, 3, 3, [2, 5, 7].includes(i) ? RED : BLUE);
      i++;
    }
    return o;
  },
};

export function PageArt({ page, size = 48 }: { page: ClassicPage; size?: number }) {
  const px = ART[page]();
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden className="page-art">
      {px.map(([x, y, c], i) => (
        <rect key={i} x={x} y={y} width={1} height={1} fill={c} />
      ))}
    </svg>
  );
}

export const PAGE_LINES: Record<ClassicPage, string> = {
  dashboard: "See what each agent did to your data.",
  network: "Each agent's steps as a graph; red = where it broke.",
  bisect: "Finds which step broke a rule in a few checks.",
  history: "Search when a customer or value changed or vanished.",
  swarm: "Run many agents; spot the rogue ones at a glance.",
};
