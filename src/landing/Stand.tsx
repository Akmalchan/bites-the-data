import { useEffect, useRef } from "react";

/* An original, procedurally drawn "menacing" humanoid silhouette, rendered as an ordered-dither halftone.
   Drawn from primitives (no traced art): a crested head, broad shoulders, a V torso, one arm raised across the face,
   the other hanging with an open hand, plus a flickering aura. Low-res canvas scaled up with pixelated rendering. */

const W = 170;
const H = 230;
const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map((v) => (v + 0.5) / 64);

function silhouette(): Float32Array {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.filter = "blur(1.2px)";
  const poly = (pts: number[][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  };
  // head: rounded helmet with a visor band, plus a single swept-back fin (no ears, no skull motifs)
  g.beginPath();
  g.ellipse(86, 50, 16, 19, 0.08, 0, Math.PI * 2);
  g.fill();
  poly([[72, 44], [60, 30], [78, 36]]);
  // neck, armored shoulders, V torso
  poly([[79, 66], [94, 66], [96, 80], [77, 80]]);
  poly([[40, 88], [52, 78], [66, 84], [108, 82], [124, 74], [136, 86], [124, 110], [108, 168], [68, 170], [54, 110]]);
  // hips and legs in a wide, twisted stance
  poly([[68, 166], [108, 164], [126, 228], [106, 228], [92, 188], [80, 228], [52, 228]]);
  // right arm thrust up and out, ending in a pointing hand
  poly([[122, 84], [134, 80], [150, 52], [140, 46]]);
  poly([[140, 46], [150, 52], [162, 22], [154, 18]]);
  poly([[152, 20], [160, 22], [168, 4], [164, 2]]);
  g.beginPath();
  g.ellipse(157, 24, 7, 6, -0.4, 0, Math.PI * 2);
  g.fill();
  // left arm bent across the waist
  poly([[48, 92], [60, 100], [70, 132], [58, 136]]);
  poly([[58, 136], [70, 132], [100, 128], [100, 140]]);
  g.beginPath();
  g.ellipse(102, 134, 7, 6, 0, 0, Math.PI * 2);
  g.fill();
  // carve armor lines so it reads as a figure, not a blob
  g.globalCompositeOperation = "destination-out";
  g.filter = "none";
  g.lineWidth = 2;
  g.strokeStyle = "#000";
  g.beginPath();
  g.moveTo(70, 50); g.lineTo(102, 50); // visor
  g.moveTo(60, 100); g.quadraticCurveTo(88, 116, 118, 98); // chest plate
  g.moveTo(88, 108); g.lineTo(88, 150); // sternum
  g.moveTo(70, 158); g.lineTo(108, 156); // belt
  g.moveTo(52, 84); g.lineTo(64, 92); // shoulder seam
  g.moveTo(124, 80); g.lineTo(130, 90);
  g.stroke();
  g.globalCompositeOperation = "source-over";
  const d = g.getImageData(0, 0, W, H).data;
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = d[i * 4] / 255;
  return out;
}

export function Stand({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const mask = silhouette();
    const img = ctx.createImageData(W, H);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = reduce ? 3 : (now - t0) / 1000;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const m = mask[i];
          // aura: rings radiating from the chest, wobbling
          const dx = (x - 88) / W;
          const dy = (y - 110) / H;
          const r = Math.sqrt(dx * dx * 1.6 + dy * dy);
          const aura = Math.max(0, 0.55 - r) * (0.55 + 0.45 * Math.sin(r * 38 - t * 2.2 + Math.sin(x * 0.07 + t) * 1.3));
          const shade = m * (0.62 + 0.38 * (1 - y / H)) + (1 - m) * aura * 0.9;
          const th = BAYER[(y & 7) * 8 + (x & 7)];
          let col: [number, number, number];
          if (m > 0.5 && shade > th * 0.9 + 0.1) col = y >= 46 && y <= 48 && ((x >= 76 && x <= 82) || (x >= 90 && x <= 96)) ? [255, 46, 136] : [14, 12, 16];
          else if (shade > th) col = aura > 0.22 && th < 0.5 ? [255, 46, 136] : [120, 72, 180];
          else if (shade * 1.8 > th) col = [220, 210, 200];
          else col = [243, 240, 232];
          const o = i * 4;
          img.data[o] = col[0];
          img.data[o + 1] = col[1];
          img.data[o + 2] = col[2];
          img.data[o + 3] = col[0] === 243 ? 0 : 255; // background stays transparent over the page
        }
      }
      ctx.putImageData(img, 0, 0);
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || now - last < 70) return;
      last = now;
      draw(now);
    };
    if (reduce) draw(t0);
    else raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} aria-hidden className={className} style={{ imageRendering: "pixelated" }} />;
}

/** Electric sparks: short-lived zigzag bolts around the wordmark. */
export function Sparks({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d")!;
    type Bolt = { pts: [number, number][]; born: number; color: string };
    let bolts: Bolt[] = [];
    let raf = 0;
    let next = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const w = (canvas.width = canvas.clientWidth * 2);
      const h = (canvas.height = canvas.clientHeight * 2);
      if (now > next) {
        next = now + 500 + Math.random() * 1400;
        const x = Math.random() * w;
        const y = Math.random() < 0.5 ? Math.random() * h * 0.25 : h * (0.75 + Math.random() * 0.25);
        const pts: [number, number][] = [[x, y]];
        for (let k = 0; k < 6; k++) {
          const [px, py] = pts[pts.length - 1];
          pts.push([px + (Math.random() - 0.3) * 36, py + (Math.random() - 0.5) * 30]);
        }
        bolts.push({ pts, born: now, color: Math.random() < 0.5 ? "#1A2BFF" : Math.random() < 0.5 ? "#FF2D2D" : "#00D1E0" });
      }
      ctx.clearRect(0, 0, w, h);
      bolts = bolts.filter((b) => now - b.born < 260);
      for (const b of bolts) {
        ctx.globalAlpha = 1 - (now - b.born) / 260;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        b.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} aria-hidden className={className} />;
}
