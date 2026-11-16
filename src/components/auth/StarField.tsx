// Deep-space backdrop for the auth screens: a static star field with a slow
// parallax drift and a couple of soft nebulae. Drawn on a canvas rather than as
// DOM nodes — a few hundred <div>s would cost more to composite than one bitmap,
// and this must stay cheap because it sits under the sign-in form.
//
// Deliberately calm: no twinkling bursts, no shooting stars. The motion is a
// sub-pixel drift you notice only if you stop and look, which is what keeps it
// from competing with the form.
import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  r: number;
  base: number;
  depth: number;
  phase: number;
}

export function StarField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let raf = 0;

    // A fixed seed keeps the constellation identical across reloads, so the page
    // does not visibly reshuffle every time the user lands on it.
    let seed = 0x9e3779b9;
    const random = (): number => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return ((seed >>> 0) % 100000) / 100000;
    };

    const build = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Density scales with area, capped so a 4K monitor does not draw thousands.
      const count = Math.min(420, Math.round((width * height) / 3400));
      seed = 0x9e3779b9;
      stars = Array.from({ length: count }, () => {
        const depth = 0.35 + random() * 0.65;
        return {
          x: random() * width,
          y: random() * height,
          r: 0.35 + depth * 1.15,
          base: 0.18 + random() * 0.62,
          depth,
          phase: random() * Math.PI * 2,
        };
      });
    };

    const draw = (time: number): void => {
      ctx.clearRect(0, 0, width, height);

      // Two nebulae: a violet wash bottom-left, a cool blue one top-right.
      const haze = ctx.createRadialGradient(
        width * 0.18, height * 0.82, 0,
        width * 0.18, height * 0.82, Math.max(width, height) * 0.62,
      );
      haze.addColorStop(0, 'rgba(124, 92, 255, 0.16)');
      haze.addColorStop(0.45, 'rgba(80, 70, 200, 0.06)');
      haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);

      const haze2 = ctx.createRadialGradient(
        width * 0.86, height * 0.12, 0,
        width * 0.86, height * 0.12, Math.max(width, height) * 0.55,
      );
      haze2.addColorStop(0, 'rgba(64, 132, 255, 0.12)');
      haze2.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = haze2;
      ctx.fillRect(0, 0, width, height);

      for (const star of stars) {
        // Nearer stars drift further; the movement is a slow diagonal crawl.
        const drift = reduceMotion ? 0 : (time * 0.0016 * star.depth) % (width + 40);
        const x = (star.x + drift) % (width + 40) - 20;
        const y = star.y + Math.sin(time * 0.00012 + star.phase) * (reduceMotion ? 0 : 3 * star.depth);
        // Gentle pulse, never below half the base brightness.
        const pulse = reduceMotion ? 1 : 0.78 + 0.22 * Math.sin(time * 0.0007 + star.phase);
        const alpha = Math.min(1, star.base * pulse);

        ctx.beginPath();
        ctx.arc(x, y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
        ctx.fill();

        // The brightest few get a bloom so the field reads as depth, not noise.
        if (star.base > 0.62) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, star.r * 5.5);
          glow.addColorStop(0, `rgba(190, 210, 255, ${(alpha * 0.35).toFixed(3)})`);
          glow.addColorStop(1, 'rgba(190, 210, 255, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, star.r * 5.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const tick = (time: number): void => {
      draw(time);
      raf = requestAnimationFrame(tick);
    };

    build();
    if (reduceMotion) {
      draw(0);
    } else {
      raf = requestAnimationFrame(tick);
    }

    const onResize = (): void => { build(); if (reduceMotion) draw(0); };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
    />
  );
}
