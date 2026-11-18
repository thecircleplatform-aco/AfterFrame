/**
 * Tier resolution.
 *
 * The rule, in order:
 *
 *   1. An explicitly chosen tier wins (`aft.tier` in localStorage).
 *   2. Otherwise, the hosted build implies the paid tier, because those hosts
 *      have a server and the current UX depends on it.
 *   3. Otherwise it is the free tier — a static/local copy with no backend.
 *
 * Step 2 is what keeps this change additive: a deployment that has never set a
 * tier behaves exactly as it did before this module existed.
 */

import { readChosenTier } from './byok';
import { TIERS, type TierId, type TierDescriptor, supportsByok } from './types';

/**
 * Hosts we operate. A build served from one of these is the hosted product, so
 * it defaults to the paid tier. Add new production hosts here, not in call
 * sites.
 */
const HOSTED_HOSTS: readonly string[] = [
  'afterframe.acocloud.app',
  'docs.afterframe.acocloud.app',
  'afterframe-2a6.pages.dev',
];

export function isHostedOrigin(origin?: string): boolean {
  if (typeof window === 'undefined' && !origin) return false;
  const host = origin ?? window.location.hostname;
  return HOSTED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
    // Every Pages preview deployment is ours too.
    || /^[a-z0-9]+\.afterframe-2a6\.pages\.dev$/.test(host);
}

/** The effective tier for this session. */
export function resolveTier(): TierId {
  const chosen = readChosenTier();
  if (chosen) return chosen;
  return isHostedOrigin() ? 'paid' : 'free';
}

export function currentTier(): TierDescriptor {
  return TIERS[resolveTier()];
}

/**
 * Should provider calls go straight to the vendor with the user's key?
 *
 * False means "use the existing `/llm` server proxy" — the pre-existing path.
 */
export function shouldUseByok(provider: string): boolean {
  return resolveTier() === 'free' && supportsByok(provider);
}

/**
 * A provider is selectable when either the tier can drive it from the browser,
 * or the tier has a server behind it.
 */
export function isProviderAvailable(provider: string): boolean {
  const tier = resolveTier();
  if (tier === 'paid') return true;
  return supportsByok(provider);
}

/**
 * Human-readable reason a provider is unavailable on the current tier, or null
 * when it is available. Used for the disabled row's tooltip.
 */
export function providerUnavailableReason(provider: string): string | null {
  if (isProviderAvailable(provider)) return null;
  return `${provider} needs a server-side key. Add a key from a browser-safe provider, or switch to the Hosted tier.`;
}
