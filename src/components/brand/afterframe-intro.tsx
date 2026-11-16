import { useEffect } from 'react';

/**
 * Drives the boot preload.
 *
 * Ported verbatim from FreeCut (`freecut/src/components/brand/afterframe-intro.tsx`).
 *
 * The visual itself lives in `index.html` as static markup + CSS, so it animates from the
 * first paint — before this bundle, React, or the workspace handle exist. That is the
 * whole point: the preload must never be waiting on the app to catch up, and no frame of
 * it is ever a parked logo.
 *
 * This component only decides *when* the finale runs:
 *   1. wait until the entrance animation has finished (a minimum run time, so a fast
 *      boot does not cut the choreography short)
 *   2. add `.af-out`, which retracts the two halves, swells the mist into a sheet of
 *      light and floods the screen white
 *   3. drop the node, revealing the already-rendered app underneath
 *
 * Mounted once from `App`, so it runs on page load and never on client-side navigation.
 */

/** Entrance (760ms) plus a beat of held mist. Must match `af-half-in` in index.html. */
const ENTRANCE_MS = 900;

/** Length of the `.af-out` finale (`af-splash-out` / `af-flood`). */
const FINALE_MS = 860;

export function AfterFrameIntro() {
  useEffect(() => {
    const splash = document.querySelector<HTMLElement>('[data-af-splash]');
    if (!splash) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      splash.remove();
      return;
    }

    const startedAt = (window as unknown as { __afSplashAt?: number }).__afSplashAt;
    const elapsed = typeof startedAt === 'number' ? Date.now() - startedAt : ENTRANCE_MS;
    const holdFor = Math.max(0, ENTRANCE_MS - elapsed);

    let removalTimer = 0;
    const finaleTimer = window.setTimeout(() => {
      splash.classList.add('af-out');
      removalTimer = window.setTimeout(() => splash.remove(), FINALE_MS + 60);
    }, holdFor);

    return () => {
      window.clearTimeout(finaleTimer);
      window.clearTimeout(removalTimer);
    };
  }, []);

  return null;
}
