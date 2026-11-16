// Locale types and constants — a leaf module so `locale.ts` and `dictRegistry.ts`
// can both use them without importing each other (that cycle left `Locale`
// undefined at module-init time and crashed the dev server).
//
// `locale.ts` re-exports everything here; import from `./locale` in app code.

export type Locale =
  | 'zh' | 'en' | 'it' | 'ru' | 'ko' | 'th'
  | 'ja' | 'es' | 'fr' | 'de' | 'pt' | 'ar'
  | 'hi' | 'id' | 'tr' | 'vi' | 'nl' | 'pl'
  | 'uk' | 'sv' | 'fa' | 'he' | 'bn' | 'ms';

/**
 * Every language the switcher offers. The first six ship hand-written
 * dictionaries; the rest are served by runtime machine translation
 * (`autoTranslate.ts`) from the English source strings.
 */
export const ALL_LOCALES: readonly Locale[] = [
  'en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'it', 'ru',
  'ar', 'hi', 'id', 'tr', 'vi', 'nl', 'pl', 'uk', 'th', 'sv',
  'fa', 'he', 'bn', 'ms',
];

/** The `lang` attribute written to `<html>` for each locale. */
export const DOCUMENT_LANG: Record<Locale, string> = {
  zh: 'zh-CN',
  en: 'en',
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

/** Display names shown in the language widget: English name + endonym. */
export interface LanguageLabel {
  /** English name — also what the agent is told the interface language is. */
  readonly english: string;
  /** The name as its own speakers write it. */
  readonly native: string;
  /** ISO 639-1 code shown in the compact top-bar pill. */
  readonly code: string;
}

export const LANGUAGE_LABELS: Record<Locale, LanguageLabel> = {
  en: { english: 'English', native: 'English', code: 'EN' },
  zh: { english: 'Chinese', native: '中文', code: '中' },
  ja: { english: 'Japanese', native: '日本語', code: 'JA' },
  ko: { english: 'Korean', native: '한국어', code: '한' },
  es: { english: 'Spanish', native: 'Español', code: 'ES' },
  fr: { english: 'French', native: 'Français', code: 'FR' },
  de: { english: 'German', native: 'Deutsch', code: 'DE' },
  pt: { english: 'Portuguese', native: 'Português', code: 'PT' },
  it: { english: 'Italian', native: 'Italiano', code: 'IT' },
  ru: { english: 'Russian', native: 'Русский', code: 'RU' },
  ar: { english: 'Arabic', native: 'العربية', code: 'AR' },
  hi: { english: 'Hindi', native: 'हिन्दी', code: 'HI' },
  id: { english: 'Indonesian', native: 'Bahasa Indonesia', code: 'ID' },
  tr: { english: 'Turkish', native: 'Türkçe', code: 'TR' },
  vi: { english: 'Vietnamese', native: 'Tiếng Việt', code: 'VI' },
  nl: { english: 'Dutch', native: 'Nederlands', code: 'NL' },
  pl: { english: 'Polish', native: 'Polski', code: 'PL' },
  uk: { english: 'Ukrainian', native: 'Українська', code: 'UK' },
  th: { english: 'Thai', native: 'ไทย', code: 'TH' },
  sv: { english: 'Swedish', native: 'Svenska', code: 'SV' },
  fa: { english: 'Persian', native: 'فارسی', code: 'FA' },
  he: { english: 'Hebrew', native: 'עברית', code: 'HE' },
  bn: { english: 'Bengali', native: 'বাংলা', code: 'BN' },
  ms: { english: 'Malay', native: 'Bahasa Melayu', code: 'MS' },
};

/** True when a hand-written dictionary exists for `locale` (not machine-only). */
export function hasAuthoredDictionary(locale: Locale): boolean {
  return locale === 'en' || locale === 'zh' || locale === 'it'
    || locale === 'ru' || locale === 'ko' || locale === 'th';
}
