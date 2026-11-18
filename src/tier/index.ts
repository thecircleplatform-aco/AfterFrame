/**
 * `src/tier` — the free/hosted tier layer.
 *
 * Everything here is additive. Nothing in this folder is imported by the
 * existing agent or editor paths unless a caller explicitly opts in, so an
 * un-patched build behaves exactly as it did before.
 *
 *   types.ts         tier descriptors, BYOK-safe provider lists
 *   byok.ts          localStorage key/URL store (client-only, never server-side)
 *   resolve.ts       which tier is active, and can a provider be used
 *   byokClient.ts    direct-to-vendor connection + CORS error surface
 *   assets.ts        runtime-asset base URL (unset = current behaviour)
 *   runtimeAssets.ts R2 group manifest, download + SHA-256 verification
 */

export * from './types';
export * from './byok';
export * from './resolve';
export * from './byokClient';
export * from './assets';
export * from './runtimeAssets';
