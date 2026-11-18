/**
 * Tier model.
 *
 * AfterFrame can run two ways, and the difference is *where the API key lives*:
 *
 *   free  — Bring Your Own Key (BYOK). The user pastes their provider key into
 *           Settings and the browser calls the provider directly. Nothing is
 *           hosted by us, nothing is billed by us, and no server is required.
 *   paid  — The key stays on our backend (the VPS). The browser talks to
 *           `/llm` on our origin and the server injects the real credential,
 *           which is the only way to use providers that block browser CORS.
 *
 * This module is the single source of truth for that decision. It is additive:
 * every existing call path keeps its current behaviour, because `resolveTier()`
 * returns the server tier whenever nothing has been explicitly chosen and the
 * origin is not one of our own deployments.
 */

export type TierId = 'free' | 'paid';

export interface TierDescriptor {
  id: TierId;
  /** Short label for chips/badges. */
  label: string;
  /** One line shown under the tier switch in Settings. */
  blurb: string;
  /**
   * True when the browser may call the provider directly with a user-supplied
   * key. False when traffic must be proxied through our own origin.
   */
  byok: boolean;
  /** True when this tier needs a reachable AfterFrame backend. */
  requiresServer: boolean;
}

export const TIERS: Readonly<Record<TierId, TierDescriptor>> = {
  free: {
    id: 'free',
    label: 'Free',
    blurb: 'Bring your own API key. Runs entirely in your browser and works offline.',
    byok: true,
    requiresServer: false,
  },
  paid: {
    id: 'paid',
    label: 'Hosted',
    blurb: 'Uses the keys already configured on our server. Nothing to paste in.',
    byok: false,
    requiresServer: true,
  },
};

export const TIER_IDS: readonly TierId[] = ['free', 'paid'];

export function isTierId(value: unknown): value is TierId {
  return value === 'free' || value === 'paid';
}

export function tierDescriptor(id: TierId): TierDescriptor {
  return TIERS[id];
}

/**
 * Providers known to allow a direct browser call (CORS `*` or the app origin).
 * Everything else must go through the server proxy, which is why the free tier
 * cannot offer them.
 */
export const BYOK_BROWSER_SAFE_PROVIDERS: readonly string[] = [
  'openai',
  'deepseek',
  'openrouter',
  'mistral',
  'xai',
  'groq',
  'ollama',
  'lmstudio',
];

/**
 * Providers that only exist on our own infrastructure (local runtimes, key
 * relays, OAuth bridges). The free tier cannot use these at all.
 */
export const SERVER_ONLY_PROVIDERS: readonly string[] = [
  'xai-oauth',
  'ofox',
  'orcarouter',
  'requesty',
  'runcrate',
  'cheaperinference',
  'agnes',
  'xiaomi',
];

/** Can the given provider be driven from the browser with a user key? */
export function supportsByok(provider: string): boolean {
  return BYOK_BROWSER_SAFE_PROVIDERS.includes(provider)
    && !SERVER_ONLY_PROVIDERS.includes(provider);
}
