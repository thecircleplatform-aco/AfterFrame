// Machine translation for strings the hand-written dictionaries do not cover.
//
// The UI keys are English, and the shipped dictionaries are complete for the
// screens they were written for — but the app grows faster than the dictionaries
// do. When the active locale is not English and a key has no entry, this fills
// the gap at runtime and caches the result, so a string is translated once per
// locale per browser and never again.
//
// Provider: MyMemory's public endpoint (no API key, no account, ~1k words/day
// anonymous). It is deliberately best-effort — a failure returns `undefined` and
// the caller falls back to the English key, which is always readable. Nothing
// blocks a render: translation is queued, batched and published asynchronously.
import { getLocale, type Locale } from './locale';

const CACHE_KEY = 'cc.autoTranslate.v2';
const FLUSH_DELAY_MS = 500;
const MAX_PER_REQUEST = 24;
const MAX_REQUESTS_PER_FLUSH = 4;
const PROVIDER = 'https://api.mymemory.translated.net/get';

/** MyMemory's language codes; only the ones the app offers are needed. */
const LANGUAGE_CODE: Record<Locale, string | null> = {
  en: null,
  zh: 'zh-CN',
  it: 'it',
  ru: 'ru',
  ko: 'ko',
  th: 'th',
};

type Cache = Record<string, string>;

let cache: Cache = loadCache();
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
const listeners = new Set<() => void>();

function loadCache(): Cache {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string'),
    ) as Cache;
  } catch {
    return {};
  }
}

let saveScheduled = false;
function saveCache(): void {
  if (saveScheduled) return;
  saveScheduled = true;
  // One write per flush rather than one per string.
  setTimeout(() => {
    saveScheduled = false;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* private mode */ }
  }, 0);
}

function cacheKey(locale: Locale, text: string): string {
  return `${locale}|${text}`;
}

function publish(): void {
  for (const listener of listeners) listener();
}

/**
 * The translated string for `text` in the active locale, or `undefined` when it
 * has not arrived yet. A miss is queued for the next flush, so calling this from
 * render is what drives translation — no separate registration step.
 */
export function autoTranslated(text: string): string | undefined {
  const locale = getLocale();
  if (LANGUAGE_CODE[locale] === null) return undefined;
  const hit = cache[cacheKey(locale, text)];
  if (hit) return hit;
  // Skip strings with nothing to translate (numbers, symbols, single letters).
  if (!/[a-z]{3}/i.test(text) || text.length > 420) return undefined;
  pending.add(text);
  scheduleFlush();
  return undefined;
}

/** Re-render subscribers when new translations land. */
export function subscribeAutoTranslate(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function scheduleFlush(): void {
  if (timer || inFlight) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

async function flush(): Promise<void> {
  const locale = getLocale();
  const code = LANGUAGE_CODE[locale];
  if (!code || pending.size === 0) return;
  inFlight = true;
  const batch = [...pending].slice(0, MAX_PER_REQUEST * MAX_REQUESTS_PER_FLUSH);
  for (const text of batch) pending.delete(text);

  let changed = false;
  for (let index = 0; index < batch.length; index += MAX_PER_REQUEST) {
    const slice = batch.slice(index, index + MAX_PER_REQUEST);
    const results = await Promise.all(slice.map((text) => requestTranslation(text, code)));
    for (let i = 0; i < slice.length; i += 1) {
      const translated = results[i];
      if (!translated) continue;
      cache[cacheKey(locale, slice[i]!)] = translated;
      changed = true;
    }
  }

  inFlight = false;
  if (changed) {
    saveCache();
    publish();
  }
  // Anything still queued (a long screen) goes out on the next tick.
  if (pending.size > 0) scheduleFlush();
}

async function requestTranslation(text: string, code: string): Promise<string | null> {
  try {
    const url = `${PROVIDER}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`en|${code}`)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = await response.json() as {
      responseStatus?: number | string;
      responseData?: { translatedText?: string };
    };
    const translated = payload?.responseData?.translatedText;
    if (!translated || typeof translated !== 'string') return null;
    // The service echoes the input on failure, and sometimes wraps warnings in
    // the payload; an unchanged or clearly-not-translated string is a miss.
    const clean = translated.replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    if (!clean || clean.toLowerCase() === text.toLowerCase()) return null;
    if (/MYMEMORY WARNING|INVALID LANGUAGE PAIR|QUERY LENGTH LIMIT/i.test(clean)) return null;
    return clean;
  } catch {
    return null;
  }
}

/** How many strings are waiting for the provider — used by the settings pane. */
export function autoTranslateQueueSize(): number {
  return pending.size;
}

/** Drop the machine cache for a locale (handy after switching dictionaries). */
export function clearAutoTranslateCache(locale?: Locale): void {
  if (!locale) {
    cache = {};
  } else {
    for (const key of Object.keys(cache)) {
      if (key.startsWith(`${locale}|`)) delete cache[key];
    }
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* private mode */ }
  publish();
}
