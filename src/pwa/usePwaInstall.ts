import { useCallback, useEffect, useState } from 'react';

/**
 * Install-to-home-screen support.
 *
 * Rules the product asked for:
 *   - the nudge appears at most once per hour, per browser
 *   - once the app is actually installed it never appears again
 *   - it never appears inside the installed app itself (standalone display)
 *
 * `beforeinstallprompt` is Chromium-only and fires once per page load, so the
 * event is captured early and held until the nudge decides to show. Safari has no
 * such event — iOS install is Share → Add to Home Screen — so this hook reports
 * `canInstall` false there rather than showing a button that cannot work.
 */

const SHOWN_AT_KEY = 'af.pwa.nudgeShownAt';
const INSTALLED_KEY = 'af.pwa.installed';
const HOUR_MS = 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the event so the nudge can call prompt() later, in a user gesture.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    try { localStorage.setItem(INSTALLED_KEY, '1'); } catch { /* private mode */ }
    deferredPrompt = null;
    notify();
  });
}

function readNumber(key: string): number {
  try {
    const value = Number(localStorage.getItem(key) ?? 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function isInstalled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    if (localStorage.getItem(INSTALLED_KEY) === '1') return true;
  } catch { /* private mode */ }
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isDue(): boolean {
  return Date.now() - readNumber(SHOWN_AT_KEY) >= HOUR_MS;
}

export interface PwaInstall {
  /** Chromium has an install prompt ready and the app isn't installed. */
  canInstall: boolean;
  /** The nudge should be on screen right now. */
  visible: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
}

export function usePwaInstall(): PwaInstall {
  const [promptReady, setPromptReady] = useState(() => deferredPrompt !== null);
  const [visible, setVisible] = useState(false);

  // Track the captured prompt, and decide once per load whether the nudge is due.
  useEffect(() => {
    const sync = (): void => { setPromptReady(deferredPrompt !== null); };
    listeners.add(sync);
    sync();
    if (deferredPrompt && !isInstalled() && isDue()) setVisible(true);
    return () => { listeners.delete(sync); };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try { localStorage.setItem(SHOWN_AT_KEY, String(Date.now())); } catch { /* private mode */ }
  }, []);

  const install = useCallback(async () => {
    const prompt = deferredPrompt;
    if (!prompt) return;
    setVisible(false);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      // Accepted: never ask again. Dismissed: fall back to the hourly rule.
      if (choice.outcome === 'accepted') {
        try { localStorage.setItem(INSTALLED_KEY, '1'); } catch { /* private mode */ }
      } else {
        try { localStorage.setItem(SHOWN_AT_KEY, String(Date.now())); } catch { /* private mode */ }
      }
    } catch {
      // A failed prompt must not leave the nudge stuck open.
    } finally {
      deferredPrompt = null;
      notify();
    }
  }, []);

  return { canInstall: promptReady && !isInstalled(), visible: visible && promptReady, install, dismiss };
}
