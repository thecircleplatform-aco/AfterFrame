/**
 * Client-side API key store for the free (BYOK) tier.
 *
 * Keys live in `localStorage` on the user's own machine and are read only by the
 * browser. They are never persisted to our backend, and the server tier keeps
 * using `.env.local` exactly as before — this module never touches that path.
 *
 * Storage layout:
 *   aft.tier                      -> 'free' | 'paid'
 *   aft.byok.keys.v1              -> { [providerId]: string }
 *   aft.byok.baseUrls.v1          -> { [providerId]: string }  (optional overrides)
 *
 * A per-provider base URL matters for BYOK: self-hosters point `ollama` at their
 * own box, and some gateways use regional hosts.
 */

const TIER_KEY = 'aft.tier';
const KEYS_KEY = 'aft.byok.keys.v1';
const BASE_URLS_KEY = 'aft.byok.baseUrls.v1';

export type KeyMap = Record<string, string>;
export type BaseUrlMap = Record<string, string>;

function readJson<T extends object>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {} as T;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {} as T;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out as T;
  } catch {
    return {} as T;
  }
}

function writeJson(key: string, value: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — BYOK simply won't persist */
  }
}

/** Explicitly chosen tier, or null when the user has never chosen one. */
export function readChosenTier(): 'free' | 'paid' | null {
  try {
    const raw = localStorage.getItem(TIER_KEY);
    return raw === 'free' || raw === 'paid' ? raw : null;
  } catch {
    return null;
  }
}

export function writeChosenTier(tier: 'free' | 'paid'): void {
  try {
    localStorage.setItem(TIER_KEY, tier);
  } catch {
    /* ignore */
  }
}

export function loadByokKeys(): KeyMap {
  return readJson<KeyMap>(KEYS_KEY);
}

export function getByokKey(provider: string): string {
  return loadByokKeys()[provider] ?? '';
}

export function setByokKey(provider: string, key: string): void {
  const next = loadByokKeys();
  const trimmed = key.trim();
  if (trimmed) next[provider] = trimmed;
  else delete next[provider];
  writeJson(KEYS_KEY, next);
}

export function clearByokKeys(): void {
  writeJson(KEYS_KEY, {});
  writeJson(BASE_URLS_KEY, {});
}

export function loadByokBaseUrls(): BaseUrlMap {
  return readJson<BaseUrlMap>(BASE_URLS_KEY);
}

export function getByokBaseUrl(provider: string): string {
  return loadByokBaseUrls()[provider] ?? '';
}

export function setByokBaseUrl(provider: string, url: string): void {
  const next = loadByokBaseUrls();
  const trimmed = url.trim();
  if (trimmed) next[provider] = trimmed;
  else delete next[provider];
  writeJson(BASE_URLS_KEY, next);
}

/** How many providers currently have a key — used for the Settings summary. */
export function byokKeyCount(): number {
  return Object.keys(loadByokKeys()).length;
}

/**
 * Mask a key for display: `sk-abcd…wxyz`. Never render the full value in the UI.
 */
export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
