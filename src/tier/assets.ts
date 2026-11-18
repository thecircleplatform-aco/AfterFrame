/**
 * Runtime asset base URL.
 *
 * The heavy binaries (MediaPipe vision WASM, Silero VAD, ONNX Runtime) are not
 * in the app bundle. Where they come from depends on the build:
 *
 *   - unset `VITE_RUNTIME_ASSETS_URL`  -> same-origin `/mediapipe/...`, exactly
 *     as before. Local dev, the desktop app and any self-hosted copy keep
 *     working with files from `public/`.
 *   - set to the R2 public URL         -> the hosted build streams them from the
 *     bucket, which is what keeps the Pages deploy under its size limits.
 *
 * Keeping the default empty is deliberate: it makes the whole R2 migration a
 * no-op for every existing environment.
 */

// `import.meta.env` is injected by Vite. Outside a Vite build (Node scripts,
// tests) it is undefined, so read it defensively rather than crashing at import.
const RAW_BASE = (import.meta as unknown as { env?: Record<string, string | undefined> })
  .env?.VITE_RUNTIME_ASSETS_URL;

/** Normalised base with no trailing slash ('' when unset). */
export const RUNTIME_ASSETS_BASE = (RAW_BASE ?? '').trim().replace(/\/+$/, '');

/** Resolve a runtime asset path. `/x/y.wasm` -> `<base>/x/y.wasm` (or `/x/y.wasm`). */
export function runtimeAsset(path: string): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${RUNTIME_ASSETS_BASE}${normalised}`;
}

/** True when assets are served from a remote (R2) origin rather than this one. */
export function usesRemoteRuntimeAssets(): boolean {
  return RUNTIME_ASSETS_BASE.length > 0;
}
