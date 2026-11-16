import type { ModelMessage } from 'ai';

export interface StandaloneSettings {
  readonly provider: string;
  readonly model: string;
  readonly askOnly: boolean;
  readonly maxOutputTokens: number;
  readonly autonomousAcceptance: boolean;
  readonly maxAcceptanceIterations: number;
  readonly cacheMode: 'short' | 'long';
  readonly reasoningEffort: string;
}

/**
 * Defaults come from Vite env so a headless/CI run can pin a model:
 *   VITE_AF_PROVIDER=openai VITE_AF_MODEL=gpt-5 npm run dev
 * Keys themselves live where the editor keeps them — the server keystore
 * (server/keystore.ts: env var, then the runtime profile keychain file), never
 * in the browser.
 */
export const DEFAULT_SETTINGS: StandaloneSettings = {
  provider: import.meta.env.VITE_AF_PROVIDER ?? 'openai',
  model: import.meta.env.VITE_AF_MODEL ?? 'gpt-5',
  askOnly: false,
  maxOutputTokens: Number(import.meta.env.VITE_AF_MAX_OUTPUT_TOKENS ?? 8_192),
  autonomousAcceptance: false,
  maxAcceptanceIterations: 3,
  cacheMode: 'short',
  reasoningEffort: import.meta.env.VITE_AF_REASONING ?? '',
};

/** One console = one durable project id, so runs survive reloads in the store. */
export const STANDALONE_PROJECT_ID =
  import.meta.env.VITE_AF_PROJECT_ID ?? 'agent-standalone-console';

export const EMPTY_HISTORY: readonly ModelMessage[] = [];
