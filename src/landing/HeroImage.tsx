import { useEffect, useRef, useState } from "react";

/** Optional hero art: the first of /hero.png, /hero.jpg, /hero.jpeg, /hero.webp that exists (served from public/). */
export function useHeroImage(): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    (async () => {
      for (const name of ["hero.png", "hero.jpg", "hero.jpeg", "hero.webp"]) {
        try {
          const r = await fetch(`/${name}`, { method: "HEAD", cache: "no-store" });
          // The SPA fallback answers 200 text/html for missing files, so require an image content type.
          if (r.ok && (r.headers.get("content-type") ?? "").startsWith("image/")) {
            if (!cancel) setSrc(`/${name}`);
            return;
          }
        } catch {
          /* offline or blocked: no hero image */
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);
  return src;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const PALETTE: [number, number, number, number][] = [
  [13, 13, 12, 255], // ink
  [26, 43, 255, 255], // VHS blue
  [232, 234, 255, 255], // blue tint
  [245, 244, 240, 0], // paper (transparent over the page)
];

/** The user's image, ordered-dithered into the landing palette at low resolution and scaled up pixelated. */
export function HeroImage({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = ref.current;
      if (!canvas) return;
      const w = 200;
      const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h);
      const d = data.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (d[i + 3] < 40) {
            d[i + 3] = 0;
            continue;
          }
          const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          const t = BAYER4[(y & 3) * 4 + (x & 3)];
          const level = Math.min(3, Math.floor(lum * 3 + t));
          const c = PALETTE[level];
          d[i] = c[0];
          d[i + 1] = c[1];
          d[i + 2] = c[2];
          d[i + 3] = c[3];
        }
      }
      ctx.putImageData(data, 0, 0);
    };
    img.onerror = () => setFailed(true);
    img.src = src;
  }, [src]);
  if (failed) return null;
  return (
    <div className="bd-art">
      <div className="bd-art-aura" aria-hidden />
      <canvas ref={ref} className="bd-art-img" role="img" aria-label="Hero art" />
      <div className="bd-art-scan" aria-hidden />
      <div className="bd-art-gos" aria-hidden>
        <span>ゴ</span>
        <span>ゴ</span>
        <span>ゴ</span>
        <span>ゴ</span>
      </div>
    </div>
  );
}
