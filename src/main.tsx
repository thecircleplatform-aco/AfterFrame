import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { TranscriptWindowRoot } from './media/TranscriptWindowRoot';
import { loadProjectFonts } from './fonts/googleFonts';
import { hydratePlugins } from './plugins/store';
import { initSkins } from './skins';
import { ensureLocaleDict, getLocale, prefetchLocaleDicts } from './i18n/locale';
import { recoverDevVitePreload } from './app/vite-preload-recovery';
import { VaultSetupDialog } from './vault/VaultSetupDialog';

// Kick the active locale's dictionary off FIRST so its fetch overlaps the setup
// below; the render waits on it so no frame renders untranslated copy. Only
// this one language is fetched — the other locales cost nothing until switched.
const localeReady = ensureLocaleDict(getLocale());

// Inject skin variables and apply persistent skin before rendering to avoid flashing the default color in the first frame.
initSkins();

// Register local font faces; TimelineComposition loads used Google faces on demand.
loadProjectFonts();

// The installed content plugin is registered in the runtime registry (visible to resource library/agent). Timeline rendering does not wait for it —
// The applied content has been snapshotted into state, see docs/plugin-system-design.md.
void hydratePlugins().catch(() => {});

/**
 * Recovery for a lazy chunk that failed to preload (a redeploy dropped the old
 * hash, or the network blipped). Ported from FreeCut.
 *
 * The route is dead either way, so the fix is a reload — but a blind reload
 * throws away unsaved work. Order is therefore save -> reload, and if the save
 * fails we do NOT navigate: losing one panel is recoverable, losing the edit
 * is not.
 */
let preloadRecoveryInFlight = false;

async function saveProjectsBeforeReload(): Promise<boolean> {
  try {
    // Lazy: the persistence graph is heavy and this only runs on a broken chunk.
    const { flushProjectSaves } = await import('./persist/projectStore');
    const result = await flushProjectSaves('all');
    return result.ok;
  } catch (error) {
    console.error('[boot] could not save projects before reload', error);
    return false;
  }
}

function reloadCurrentLocationWithCacheBust(): void {
  // A query param, not a path change: the router only reads the params it knows
  // (`transcript-window`), so an extra one cannot change the route it resolves.
  const url = new URL(window.location.href);
  url.searchParams.set('__afterframe_preload', String(Date.now()));
  window.location.replace(url.toString());
}

function showSaveBeforeReloadFailedNotice(): void {
  // AfterFrame has no global toast surface, and this is a data-loss guard, so it
  // has to be visible: silently carrying on would let the user keep editing a
  // project the app has already failed to persist.
  console.error('[boot] project save failed; skipping the reload that would discard it');
  window.alert(
    'Could not save your project, so the page was not reloaded. Save manually, then refresh.',
  );
}

window.addEventListener('vite:preloadError', (event) => {
  // Vite's default is to log and rethrow. Either way the route is dead, so dev
  // and production both recover the same way.
  event.preventDefault();
  if (preloadRecoveryInFlight) return;
  preloadRecoveryInFlight = true;
  void recoverDevVitePreload({
    save: saveProjectsBeforeReload,
    reload: reloadCurrentLocationWithCacheBust,
    onSaveFailure: showSaveBeforeReloadFailedNotice,
  }).then((didReload) => {
    if (!didReload) preloadRecoveryInFlight = false;
  });
});

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
const isTranscriptWindow = new URLSearchParams(window.location.search).has('transcript-window');
void localeReady.then(() => {
  createRoot(root).render(
    <StrictMode>
      {isTranscriptWindow ? <TranscriptWindowRoot /> : <App />}
      {/* First-run only: offers a real folder for projects + media. Mounted at the
          root so it appears before the user creates anything worth relocating. */}
      {!isTranscriptWindow && <VaultSetupDialog />}
    </StrictMode>,
  );
  // Warm the other languages only once the first paint is out of the way, so
  // the language switcher stays instant without competing for the boot.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(prefetchLocaleDicts);
  else setTimeout(prefetchLocaleDicts, 2_000);

  // Service worker makes the app installable (browsers require one with a fetch
  // handler). Registered only in production builds: in dev it would sit between
  // Vite's HMR socket and the browser. The worker itself caches nothing.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Installability is a nicety; a failed registration must not surface.
      });
    });
  }
});
