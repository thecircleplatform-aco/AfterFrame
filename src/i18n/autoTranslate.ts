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

const CACHE_KEY = 'cc.autoTranslate.v3';
const FLUSH_DELAY_MS = 500;
const MAX_PER_REQUEST = 24;
const MAX_REQUESTS_PER_FLUSH = 4;
const PROVIDER = 'https://api.mymemory.translated.net/get';

/**
 * Optional translation API key. Injected at build/dev time from the server
 * environment (`TRANSLATE_API_KEY` / `GOOGLE_TRANSLATE_API_KEY`), never hard
 * coded. When present, the official Google Cloud Translation v2 endpoint is
 * used (better coverage and no per-IP quota); otherwise the public MyMemory
 * endpoint is the key-free fallback so the feature still works out of the box.
 */
const API_KEY = String(
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_TRANSLATE_API_KEY ?? '',
).trim();
const GOOGLE_ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

/**
 * MyMemory's language codes; only the ones the app offers are needed.
 * The authored dictionaries (`dict/*`) are preferred; these codes are only
 * consulted for keys they do not carry.
 */
const LANGUAGE_CODE: Record<Locale, string | null> = {
  en: null,
  zh: 'zh-CN',
  it: 'it',
  ru: 'ru',
  ko: 'ko',
  th: 'th',
  ja: 'ja',
  es: 'es',
  fr: 'fr',
  de: 'de',
  pt: 'pt',
  ar: 'ar',
  hi: 'hi',
  id: 'id',
  tr: 'tr',
  vi: 'vi',
  nl: 'nl',
  pl: 'pl',
  uk: 'uk',
  sv: 'sv',
  fa: 'fa',
  he: 'he',
  bn: 'bn',
  ms: 'ms',
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
    const results = await translateSlice(slice, code);
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

/**
 * Google Cloud Translation v2 — used when an API key is configured. One POST
 * carries the whole slice (`q` repeated), so a batch of 24 strings costs one
 * request instead of 24.
 */
async function googleTranslate(texts: string[], code: string): Promise<(string | null)[]> {
  const body = new URLSearchParams();
  body.set('target', code);
  body.set('format', 'text');
  for (const text of texts) body.append('q', text);
  const response = await fetch(`${GOOGLE_ENDPOINT}?key=${encodeURIComponent(API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: body.toString(),
  });
  if (!response.ok) return texts.map(() => null);
  const payload = await response.json() as {
    data?: { translations?: { translatedText?: string }[] };
  };
  const list = payload?.data?.translations ?? [];
  return texts.map((text, index) => cleanTranslation(list[index]?.translatedText, text));
}

/** Public, key-free MyMemory endpoint — one request per string. */
async function myMemoryTranslate(text: string, code: string): Promise<string | null> {
  const url = `${PROVIDER}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`en|${code}`)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const payload = await response.json() as {
    responseStatus?: number | string;
    responseData?: { translatedText?: string };
  };
  return cleanTranslation(payload?.responseData?.translatedText, text);
}

/**
 * The service echoes the input on failure, and sometimes wraps warnings in the
 * payload; an unchanged or clearly-not-translated string is a miss.
 */
function cleanTranslation(translated: unknown, source: string): string | null {
  if (!translated || typeof translated !== 'string') return null;
  const clean = translated.replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  if (!clean || clean.toLowerCase() === source.toLowerCase()) return null;
  if (/MYMEMORY WARNING|INVALID LANGUAGE PAIR|QUERY LENGTH LIMIT/i.test(clean)) return null;
  return clean;
}

async function translateSlice(texts: string[], code: string): Promise<(string | null)[]> {
  try {
    return API_KEY ? await googleTranslate(texts, code) : await Promise.all(texts.map((text) => myMemoryTranslate(text, code)));
  } catch {
    return texts.map(() => null);
  }
}

/** True when an official translation API key is configured for this build. */
export function autoTranslateHasApiKey(): boolean {
  return API_KEY.length > 0;
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
