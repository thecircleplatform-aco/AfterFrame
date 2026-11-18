/**
 * BYOK transport.
 *
 * Turns a provider id + the user's own key into the `baseURL` / `headers` the
 * AI SDK needs to call the vendor directly from the browser.
 *
 * Deliberately separate from `src/agent/client.ts`: that file's proxy path stays
 * byte-identical, and callers opt into this only when `shouldUseByok()` is true.
 */

import { getByokBaseUrl, getByokKey } from './byok';

/** Default public endpoints. Only providers that permit browser CORS belong here. */
const DEFAULT_BASE_URLS: Readonly<Record<string, string>> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  openrouter: 'https://openrouter.ai/api/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
};

export function defaultBaseUrl(provider: string): string {
  return DEFAULT_BASE_URLS[provider] ?? '';
}

/** The base URL actually used: the user's override, else the public default. */
export function resolvedBaseUrl(provider: string): string {
  return getByokBaseUrl(provider) || defaultBaseUrl(provider);
}

export interface ByokConnection {
  baseURL: string;
  apiKey: string;
  headers: Record<string, string>;
}

export type ByokResult =
  | { ok: true; connection: ByokConnection }
  | { ok: false; reason: 'missing-key' | 'missing-base-url' };

/**
 * Build the connection for a provider, or explain why we cannot.
 *
 * Local runtimes (ollama, lmstudio) accept any non-empty key, so a placeholder
 * is substituted when the user left the field blank — that keeps the "just point
 * me at my local box" flow to a single field.
 */
export function byokConnection(provider: string): ByokResult {
  const baseURL = resolvedBaseUrl(provider);
  if (!baseURL) return { ok: false, reason: 'missing-base-url' };

  const stored = getByokKey(provider);
  const local = provider === 'ollama' || provider === 'lmstudio';
  if (!stored && !local) return { ok: false, reason: 'missing-key' };

  const headers: Record<string, string> = {};
  // OpenRouter asks for attribution headers; harmless for the others.
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : '';
    headers['X-Title'] = 'AfterFrame';
  }

  return {
    ok: true,
    connection: { baseURL, apiKey: stored || 'afterframe-local', headers },
  };
}

/**
 * A CORS block looks like a network error in the browser, which is unhelpful.
 * This class lets the UI say something true instead: the provider refused a
 * browser-origin call, so the user should either pick another provider or use
 * the hosted tier.
 */
export class ByokCorsError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(
      `${provider} refused the request from this page (CORS). `
      + 'Switch to a browser-safe provider, or use the Hosted tier where the key is '
      + 'applied server-side.',
    );
    this.name = 'ByokCorsError';
    this.provider = provider;
  }
}

/** Wrap a fetch so a swallowed network failure becomes an actionable error. */
export function byokFetch(provider: string): typeof fetch {
  return async (input, init) => {
    try {
      return await globalThis.fetch(input, init);
    } catch (error) {
      // A TypeError with no response is the browser's CORS / DNS failure signal.
      if (error instanceof TypeError) throw new ByokCorsError(provider);
      throw error;
    }
  };
}
