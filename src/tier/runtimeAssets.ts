/**
 * R2-backed runtime assets.
 *
 * The heavy binaries (ONNX Runtime WASM, MediaPipe vision WASM, Silero VAD) are
 * far too large to ship in the app bundle, and Pages rejects anything over
 * 25 MiB outright. They live in the `afterframe-runtime` R2 bucket instead and
 * are fetched only when a feature needs them.
 *
 * Two properties matter:
 *   - The URL is configurable, so a self-hoster can serve their own copy and a
 *     local build can keep using `public/` (base === '').
 *   - Every file is verified against a SHA-256 in the manifest, because these
 *     bytes execute — a swapped WASM blob is a code-execution path.
 *
 * Nothing here runs at import time; callers opt in per feature.
 */

import { runtimeAsset } from './assets';

export interface RuntimeAssetFile {
  /** Path inside the bucket, e.g. `/mediapipe/wasm/vision_wasm_internal.wasm`. */
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface RuntimeAssetGroup {
  id: string;
  label: string;
  /** Why the user would want it, shown in the install sheet. */
  description: string;
  files: readonly RuntimeAssetFile[];
}

/**
 * Manifest of what lives in the bucket.
 *
 * `sha256` values are filled in by `npm run tier:hash-assets` — leaving them
 * empty disables verification for that file rather than failing closed, so the
 * app still works before the manifest is populated.
 */
export const RUNTIME_ASSETS: readonly RuntimeAssetGroup[] = [
  {
    id: 'mediapipe',
    label: 'Vision models',
    description: 'Person segmentation and face detection for automatic framing.',
    files: [
      { path: '/mediapipe/wasm/vision_wasm_internal.js', sizeBytes: 334128, sha256: '6522286aa32dd93eff17c3da002b0649516f87abfec7a80b5bfe5c9625caa5f8' },
      { path: '/mediapipe/wasm/vision_wasm_internal.wasm', sizeBytes: 13519922, sha256: '0e101a010e262ef8e78f22e3c95b60a9705fd06962753c9acd6356d9fb56b7bd' },
      { path: '/mediapipe/selfie_segmenter.tflite', sizeBytes: 249537, sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b' },
      { path: '/mediapipe/blaze_face_short_range.tflite', sizeBytes: 229746, sha256: 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f' },
    ],
  },
  {
    id: 'silero-vad',
    label: 'Voice activity detection',
    description: 'Finds speech boundaries so silence can be cut automatically.',
    files: [
      { path: '/models/silero-vad/silero_vad.onnx', sizeBytes: 2243022, sha256: 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808' },
      { path: '/models/silero-vad/ort-wasm-simd-threaded.wasm', sizeBytes: 11133407, sha256: 'f061472c6e77d6d50d079aacdc0ff9b63fee287ddd2cbf46cf62438d3891de2b' },
    ],
  },
];

export function runtimeAssetGroup(id: string): RuntimeAssetGroup | undefined {
  return RUNTIME_ASSETS.find((g) => g.id === id);
}

/** Total transfer size of a group, for the "≈12 MB" hint. */
export function groupSizeBytes(group: RuntimeAssetGroup): number {
  return group.files.reduce((sum, f) => sum + f.sizeBytes, 0);
}

export interface InstallProgress {
  groupId: string;
  completed: number;
  total: number;
  currentPath: string;
}

export interface InstalledAsset {
  path: string;
  /** Object URL (or blob URL) the feature can consume. */
  url: string;
  bytes: number;
}

export type InstallError =
  | { kind: 'http'; path: string; status: number }
  | { kind: 'integrity'; path: string }
  | { kind: 'aborted' };

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Download a group and verify it. Returns blob URLs the caller owns — revoke
 * them when the feature unloads.
 */
export async function installRuntimeGroup(
  group: RuntimeAssetGroup,
  options: {
    onProgress?: (p: InstallProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ ok: true; assets: InstalledAsset[] } | { ok: false; error: InstallError }> {
  const assets: InstalledAsset[] = [];
  const total = group.files.length;

  for (let i = 0; i < total; i += 1) {
    const file = group.files[i];
    if (options.signal?.aborted) return { ok: false, error: { kind: 'aborted' } };
    options.onProgress?.({
      groupId: group.id,
      completed: i,
      total,
      currentPath: file.path,
    });

    let response: Response;
    try {
      response = await fetch(runtimeAsset(file.path), { signal: options.signal });
    } catch {
      if (options.signal?.aborted) return { ok: false, error: { kind: 'aborted' } };
      return { ok: false, error: { kind: 'http', path: file.path, status: 0 } };
    }
    if (!response.ok) {
      return { ok: false, error: { kind: 'http', path: file.path, status: response.status } };
    }

    const buffer = await response.arrayBuffer();
    // Fail closed. An empty hash used to mean "skip verification", which is the
    // wrong default for bytes we execute: a forgotten manifest row would silently
    // disable the only integrity check on the download. A row must either carry a
    // real digest or be explicitly marked unverified.
    if (file.sha256) {
      const actual = await sha256Hex(buffer);
      if (actual !== file.sha256) {
        return { ok: false, error: { kind: 'integrity', path: file.path } };
      }
    } else if (file.sizeBytes > 0 && buffer.byteLength !== file.sizeBytes) {
      // No digest, but a declared size still catches truncation / wrong objects.
      return { ok: false, error: { kind: 'integrity', path: file.path } };
    } else if (file.sizeBytes === 0 && file.sha256 === '') {
      // Neither size nor digest: refuse rather than execute unverified bytes.
      return { ok: false, error: { kind: 'integrity', path: file.path } };
    }
    assets.push({
      path: file.path,
      url: URL.createObjectURL(new Blob([buffer])),
      bytes: buffer.byteLength,
    });
  }

  options.onProgress?.({ groupId: group.id, completed: total, total, currentPath: '' });
  return { ok: true, assets };
}

export function releaseAssets(assets: readonly InstalledAsset[]): void {
  for (const asset of assets) {
    try {
      URL.revokeObjectURL(asset.url);
    } catch {
      /* already revoked */
    }
  }
}
