// Language status + t(): The original Chinese text is the key (no additional key namespace is created),
// if the active-language dictionary cannot be found, it will fall back to Chinese.
// Never go blank. Switch persistence localStorage('cc.locale'), subscription rerendering (useSyncExternalStore).
// Rules: Use useT() (subscription switching) in React components; pure helper modules can directly import { t }
//  — As long as the component that renders its output calls useT(), it will be recalculated when switching languages.
// LLM interface (systemPrompt/tool ​​description/skill content) and persistent dynamic history tags do not enter i18n.
// Default language: the saved choice wins; otherwise the system language (zh/it/ru/ko/th), and English for everything else.
import { useSyncExternalStore } from 'react';
import { ensureLocaleDict, localeDictReady, localeDicts } from './dictRegistry';
import { autoTranslated, subscribeAutoTranslate } from './autoTranslate';

export { ensureLocaleDict } from './dictRegistry';
// Locale types/constants live in the leaf module `locales.ts` so `dictRegistry.ts`
// can import them without creating a cycle back into this file.
export {
  ALL_LOCALES, LANGUAGE_LABELS, hasAuthoredDictionary,
  type Locale, type LanguageLabel,
} from './locales';
import { ALL_LOCALES, DOCUMENT_LANG, LANGUAGE_LABELS, type Locale } from './locales';

const STORAGE_KEY = 'cc.locale';

function systemLocale(): Locale {
  try {
    const tag = String(navigator.language ?? '').toLowerCase();
    if (tag.startsWith('zh')) return 'zh';
    if (tag.startsWith('it')) return 'it';
    if (tag.startsWith('ru')) return 'ru';
    if (tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('th')) return 'th';
    return 'en';
  } catch {
    return 'en';
  }
}

/** Exported for the settings "follow system language" affordance. */
export function detectedSystemLocale(): Locale {
  return systemLocale();
}

function readInitial(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (ALL_LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  } catch {
    // Private mode / storage disabled → English below.
  }
  // English is the product's primary language. The UI no longer guesses from
  // the browser locale, so a first launch never opens in a language the user
  // did not pick; the switcher still offers every locale.
  return 'en';
}

let current: Locale = readInitial();
if (typeof document !== 'undefined') document.documentElement.lang = DOCUMENT_LANG[current];
const subscribers = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/** Subscribe to locale switches; returns the unsubscribe function. */
export function subscribeLocale(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => { subscribers.delete(onChange); };
}

/**
 * The English name of a language, injected into the agent's system prompt.
 * Only the authored locales have a literal union type; the machine-translated
 * ones are reported as their English name too, which is what the model needs.
 */
export function localeLanguageName(locale: Locale):
  | 'Chinese' | 'English' | 'Italian' | 'Russian' | 'Korean' | 'Thai' {
  const name = LANGUAGE_LABELS[locale]?.english ?? 'English';
  return name as 'Chinese' | 'English' | 'Italian' | 'Russian' | 'Korean' | 'Thai';
}

export function localizedCatalogText(
  english: string,
  chinese: string,
  locale: Locale = current,
): string {
  return locale === 'zh' ? chinese : english;
}

function notifySubscribers(): void {
  subscribers.forEach((notify) => notify());
}

export function setLocale(next: Locale): void {
  if (next === current) return;
  const alreadyLoaded = localeDictReady(next);
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch { /* If the private mode cannot be saved, it will only affect this session */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = DOCUMENT_LANG[next];
  }
  // Switch the UI now — an unloaded dictionary renders the Chinese original
  // rather than nothing — then re-render once the dictionary lands. In practice
  // prefetchLocaleDicts() has already loaded it and no second pass happens.
  notifySubscribers();
  if (!alreadyLoaded) void ensureLocaleDict(next).then(notifySubscribers);
}

/**
 * Warm the dictionaries the user has not selected, so switching language is
 * instant. Call after the first paint — never before, it competes with it.
 */
export function prefetchLocaleDicts(): void {
  for (const locale of ALL_LOCALES) {
    if (locale !== current) void ensureLocaleDict(locale);
  }
}

/** t('Selected {n}', { n: 3 }) - The Chinese original text is the key; the placeholder {name} has the same name in both languages. */
export function t(zh: string, params?: Record<string, string | number>): string {
  const { ui, uiFallback } = localeDicts(current);
  // Order matters:
  //  1. this locale's hand-written dictionary,
  //  2. its fallback (English for the contributed locales),
  //  3. runtime machine translation for keys no dictionary carries yet,
  //  4. the key itself, which is the English source string. Never blank.
  //
  // Step 3 must come BEFORE a fallback dictionary that is not English: machine
  // translation is from the English source, while e.g. the Italian table would
  // hand a Japanese reader Italian strings. Only English is an acceptable
  // "readable" last resort.
  const machine = autoTranslated(zh);
  const raw = ui[zh]
    ?? uiFallback[zh]
    ?? machine
    ?? zh;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

/** Two-way data localization: **data** names (template names, etc.) are displayed according to the current language in the table lookup. If not found, they are returned as they are.
 * English key data (211 built-in items) zh state walking ZH_DATA; Chinese key data (self-made package) en state walking EN_DATA.
 * It is only used for display and does not change the data itself (the name is also a reference key). */
export function tData(text: string): string {
  const { data, dataFallback } = localeDicts(current);
  return data[text] ?? dataFallback[text] ?? text;
}

/** Get t in the component: subscribe to language switching, trigger rerendering of this component when switching. */
export function useT(): typeof t {
  useSyncExternalStore(
    (onChange) => {
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
    () => current,
    () => current,
  );
  // A second subscription for machine translations: batches arrive after the
  // first paint, and the components that asked for those keys must repaint.
  useTranslationsVersion();
  return t;
}

function useTranslationsVersion(): void {
  useSyncExternalStore(
    (onChange) => subscribeAutoTranslate(onChange),
    translationVersion,
    translationVersion,
  );
}

let translationsVersion = 0;
subscribeAutoTranslate(() => { translationsVersion += 1; });
const translationVersion = (): number => translationsVersion;
