// Runtime dependency inspection and provisioning for the desktop agent.
//
// The agent can hit a wall that is not a model problem: whisper.cpp was never
// provisioned, ffmpeg is missing from PATH, a local model pack is absent. Until
// now the only honest answer was "tell the user to run npm run sync:…", which
// meant a terminal round-trip and a stalled conversation.
//
// This module lets the agent ASK: enumerate what is missing, why it matters, and
// offer a one-click install. Nothing here installs on its own — `install()`
// is only called after the user approves the action in the UI, matching how
// every other persistent local change in this app is gated.
//
// Design notes:
// - Everything is a pure inspection function so the endpoint stays cheap and
//   repeatable (the UI polls it while a run is active).
// - Installers shell out to the SAME pinned provisioning scripts the build uses
//   (scripts/sync-*.mjs). Re-implementing a download here would fork the
//   integrity pinning (sha256 + provenance records) and rot independently.
// - Only a fixed set of known dependency ids can be installed. The id is a key
//   into this registry, never a command string, so the endpoint cannot be turned
//   into arbitrary command execution by a prompt-injected tool call.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ASR_MODELS, GGML_UPSTREAM_MODEL_ID } from '../shared/asr-models.ts';
import { ffmpegBin, ffprobeBin, whisperCliBin } from './media-binaries.ts';

const ROOT = join(import.meta.dirname, '..');

export type DependencyId =
  | 'ffmpeg'
  | 'whisper-cli'
  | 'whisper-model'
  | 'mediapipe'
  | 'rhythm-pack'
  | 'music-semantics-pack';

export type DependencyStatus = 'ready' | 'missing' | 'partial';

export interface DependencyReport {
  readonly id: DependencyId;
  readonly label: string;
  /** One sentence on what breaks without it, in the user's terms. */
  readonly consequence: string;
  readonly status: DependencyStatus;
  /** Human-readable detail: resolved path, version, or what is absent. */
  readonly detail: string;
  /** True when `install` would do something. */
  readonly installable: boolean;
  /**
   * Rough download size in bytes, when known. Shown in the approval sheet so the
   * user is not asked to approve an unbounded download.
   */
  readonly approxBytes?: number;
  /** Why the user would still have to act after installing (e.g. macOS build). */
  readonly note?: string;
}

export interface InstallResult {
  readonly ok: boolean;
  readonly id: DependencyId;
  /** Tail of the installer output, trimmed. Surfaced on failure. */
  readonly output: string;
  readonly error?: string;
}

/** Runs a command to completion, never throwing on a non-zero exit. */
function run(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve({ code, output: output.trim() });
    };
    let child;
    try {
      child = spawn(command, [...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      finish(1);
      output = error instanceof Error ? error.message : String(error);
      return;
    }
    const timer = setTimeout(() => {
      output += '\n(timed out)';
      child.kill();
      finish(124);
    }, timeoutMs);
    timer.unref?.();
    const collect = (chunk: Buffer): void => {
      // Keep only the tail: installer logs can be long and we only need the
      // reason on failure.
      output = (output + chunk.toString('utf8')).slice(-4000);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => {
      output += `\n${error.message}`;
      finish(1);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code ?? 1);
    });
  });
}

const VERSION_PROBE_MS = 5_000;

async function ffmpegReport(): Promise<DependencyReport> {
  const bin = ffmpegBin();
  const probe = ffprobeBin();
  const [ff, fp] = await Promise.all([
    run(bin, ['-version'], VERSION_PROBE_MS),
    run(probe, ['-version'], VERSION_PROBE_MS),
  ]);
  const version = /ffmpeg version (\S+)/i.exec(ff.output)?.[1] ?? '';
  const ready = ff.code === 0 && fp.code === 0;
  return {
    id: 'ffmpeg',
    label: 'FFmpeg',
    consequence: 'Media import, thumbnails, audio extraction, scene detection and most exports fail without it.',
    status: ready ? 'ready' : 'missing',
    detail: ready
      ? `${version || 'ffmpeg'} at ${bin}`
      : 'ffmpeg / ffprobe not found. They normally ship with the app.',
    // ffmpeg is a production dependency with no download step, so there is no
    // installer to offer. Advertising one would produce a button that always
    // fails, so point at the real fix instead.
    installable: false,
    ...(ready ? {} : {
      note: 'Reinstall or restart the app; ffmpeg ships with it. If you set AFTERFRAME_FFMPEG, check that the path exists.',
    }),
  };
}

/** Whisper needs the binary AND a weights file; either one missing is useless. */
async function whisperReport(): Promise<DependencyReport[]> {
  const bin = whisperCliBin();
  const binaryReady = existsSync(bin);
  const modelsDir = join(ROOT, 'public', 'whisper-cli', 'models');
  let models: string[] = [];
  try {
    const { readdir } = await import('node:fs/promises');
    models = (await readdir(modelsDir)).filter((name) => name.endsWith('.bin'));
  } catch {
    // No models directory yet — reported as missing below.
  }
  return [
    {
      id: 'whisper-cli',
      label: 'Whisper CLI (offline transcription)',
      consequence: 'Offline transcription is unavailable; transcription falls back to a paid cloud provider.',
      status: binaryReady ? 'ready' : 'missing',
      detail: binaryReady ? `whisper-cli at ${bin}` : `not provisioned at ${bin}`,
      installable: !binaryReady,
      approxBytes: 9 * 1024 * 1024,
      note: process.platform === 'darwin'
        ? 'macOS has no official prebuilt binary; the installer compiles from source and needs Xcode command line tools.'
        : undefined,
    },
    {
      id: 'whisper-model',
      label: 'Whisper model weights',
      consequence: 'Offline transcription cannot run until a model file is present.',
      status: models.length > 0 ? 'ready' : 'missing',
      detail: models.length > 0
        ? models.join(', ')
        : 'no .bin model file in public/whisper-cli/models',
      // Weights ARE installable now, from the pinned GGML entry in the ASR
      // catalog. Previously this advertised no installer, which forced every
      // user through Settings before the agent could transcribe anything —
      // and an agent that cannot transcribe cannot add subtitles, which is the
      // single most requested long-form task.
      //
      // Safety is unchanged: the file is pinned by SHA-256 in the catalog, so
      // the installer verifies bytes rather than trusting a URL. There is no
      // arbitrary-command surface: the dependency id selects a pinned artifact,
      // never a shell string.
      installable: models.length === 0,
      approxBytes: ggmlModelBytes(),
      ...(models.length > 0 ? {} : {
        note: 'The agent can install this automatically when it needs subtitles.',
      }),
    },
  ];
}

/**
 * Size of the GGML weights the installer would fetch, so the UI can show a real
 * number instead of "unknown". Falls back to the smallest tier when the catalog
 * cannot be read, which keeps the report shaped even on a damaged checkout.
 */
function ggmlModelBytes(): number {
  return GGML_ASR_MODEL?.sizeBytes ?? 0;
}

/**
 * Which GGML weights to install. "base" is the default: "tiny" mishears too
 * much to be worth the time saved on a 49-minute narration, and "small" costs
 * roughly triple the disk for a gain the default viewers will not notice.
 */
const GGML_ASR_MODEL = ASR_MODELS.find((entry) => entry.id === 'base')?.ggmlFile;

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Install the whisper.cpp weights the offline transcriber needs.
 *
 * Order is R2 first, then the public HF mirrors through the existing proxy.
 * R2 comes first because it is the one origin the operator controls; the
 * mirrors remain as a fallback so a self-hosted install without a bucket still
 * works exactly as it did before.
 *
 * The SHA-256 comes from the pinned catalog, so neither source is trusted: the
 * bytes are proved correct before the file is moved into place. That is what
 * makes this safe to expose to an agent — a compromised or mismatched download
 * is rejected, not installed.
 */
async function installWhisperModel(): Promise<InstallResult> {
  const target = GGML_ASR_MODEL;
  if (!target) {
    return { ok: false, id: 'whisper-model', output: '', error: 'the ASR catalog has no GGML weights to install' };
  }
  const modelsDir = join(ROOT, 'public', 'whisper-cli', 'models');
  const destination = join(modelsDir, target.fileName);
  await mkdir(modelsDir, { recursive: true });

  // Already installed and intact: report success rather than re-downloading.
  if (existsSync(destination)) {
    const size = (await stat(destination)).size;
    if (size === target.sizeBytes && await sha256File(destination) === target.sha256) {
      return { ok: true, id: 'whisper-model', output: `${target.fileName} is already installed` };
    }
    await rm(destination, { force: true }).catch(() => undefined);
  }

  const partial = `${destination}.part`;
  const verify = async (): Promise<boolean> => {
    if (!existsSync(partial)) return false;
    const size = (await stat(partial)).size;
    if (size !== target.sizeBytes) return false;
    return await sha256File(partial) === target.sha256;
  };

  const attempts: string[] = [];

  // 1) R2 — the operator's own origin.
  const { fetchDependencyFromR2, r2DependencySourceAvailable } = await import('./r2-dependencies.ts');
  if (r2DependencySourceAvailable()) {
    const fromR2 = await fetchDependencyFromR2(
      { modelId: 'whisper-cli', revision: target.revision, filePath: target.fileName },
      partial,
    );
    if (fromR2.kind === 'downloaded' && await verify()) {
      await rename(partial, destination);
      return {
        ok: true,
        id: 'whisper-model',
        output: `installed ${target.fileName} from R2 (${Math.round(fromR2.bytes / (1024 * 1024))} MB)`,
      };
    }
    attempts.push(`R2: ${fromR2.kind === 'downloaded' ? 'SHA-256 mismatch' : fromR2.kind === 'failed' ? fromR2.error : fromR2.reason}`);
    await rm(partial, { force: true }).catch(() => undefined);
  } else {
    attempts.push('R2: not configured');
  }

  // 2) Public mirrors via the existing proxy (which does its own verification).
  try {
    const { downloadModelFile } = await import('./plugins/hf-proxy.ts');
    // whisper.cpp weights are not part of the ONNX ASR tuples the proxy
    // whitelists, so pass the expected hash explicitly. Without it the proxy
    // would refuse the tuple — and an unverified download is worse than none.
    const downloaded = await downloadModelFile(
      {
        modelId: GGML_UPSTREAM_MODEL_ID,
        // The ggmlFile revisions pinned in the catalog (5359861…) belong to a
        // repository that does not serve these files. ggerganov/whisper.cpp
        // publishes them on `main`; the catalog SHA-256 remains the authority on
        // whether the downloaded bytes are the right ones, so tracking `main`
        // here cannot install unverified content.
        revision: 'main',
        filePath: target.fileName,
      },
      destination,
      { expectedBytes: target.sizeBytes, expectedSha256: target.sha256 },
    ).catch((error: unknown) => {
      attempts.push(`mirror: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (downloaded && existsSync(downloaded)) {
      const size = (await stat(downloaded)).size;
      if (size === target.sizeBytes && await sha256File(downloaded) === target.sha256) {
        return {
          ok: true,
          id: 'whisper-model',
          output: `installed ${target.fileName} (${Math.round(size / (1024 * 1024))} MB)`,
        };
      }
      attempts.push('mirror: downloaded file failed SHA-256 verification');
      await rm(downloaded, { force: true }).catch(() => undefined);
    }
  } catch (error) {
    attempts.push(`mirror: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    ok: false,
    id: 'whisper-model',
    output: '',
    error: `could not install ${target.fileName}. ${attempts.join('; ')}`,
  };
}

async function mediapipeReport(): Promise<DependencyReport> {
  const dir = join(ROOT, 'public', 'mediapipe');
  let present = false;
  try {
    const { readdir } = await import('node:fs/promises');
    present = (await readdir(dir)).length > 0;
  } catch {
    present = false;
  }
  return {
    id: 'mediapipe',
    label: 'MediaPipe wasm runtime',
    consequence: 'In-browser face/pose/hand tracking and the related auto-reframe tools are unavailable.',
    status: present ? 'ready' : 'missing',
    detail: present ? `assets in ${dir}` : `not synced to ${dir}`,
    installable: !present,
    approxBytes: 12 * 1024 * 1024,
  };
}

/**
 * Local model packs, inspected through the same code the Settings pane uses.
 *
 * These are the ones whose absence produced permanent "not installed" text in
 * the media pool. Installing them here means the notice can offer a real action
 * instead of telling every user to go find a settings page.
 */
const MODEL_PACK_DEPS: ReadonlyArray<{
  readonly id: DependencyId;
  readonly packId: string;
  readonly label: string;
  readonly consequence: string;
  readonly approxBytes: number;
}> = [
  {
    id: 'rhythm-pack',
    packId: 'rhythm-lite',
    label: 'Rhythm analysis pack',
    consequence: 'Beat detection and beat-synced cuts are unavailable; music cards show no analysis entry.',
    approxBytes: 83_407_111,
  },
  {
    id: 'music-semantics-pack',
    packId: 'music-semantics-lite',
    label: 'Music embedding pack',
    consequence: 'Music mood/semantic matching is unavailable, so tracks cannot be matched to the cut by feel.',
    approxBytes: 34_302_907,
  },
];

async function modelPackReports(): Promise<DependencyReport[]> {
  const { isModelPackInstalled } = await import('./plugins/model-packs.ts');
  return Promise.all(MODEL_PACK_DEPS.map(async (entry) => {
    let installed = false;
    try {
      installed = await isModelPackInstalled(entry.packId);
    } catch {
      // A broken cache must read as "missing", not crash the whole report.
      installed = false;
    }
    return {
      id: entry.id,
      label: entry.label,
      consequence: entry.consequence,
      status: installed ? 'ready' : 'missing',
      detail: installed ? 'installed and verified' : 'not downloaded',
      installable: !installed,
      approxBytes: entry.approxBytes,
    } satisfies DependencyReport;
  }));
}

/** Every dependency this build can inspect. Order is the UI's order. */
export async function inspectDependencies(): Promise<DependencyReport[]> {
  const [ffmpeg, whisper, mediapipe, packs] = await Promise.all([
    ffmpegReport(),
    whisperReport(),
    mediapipeReport(),
    modelPackReports(),
  ]);
  return [ffmpeg, ...whisper, mediapipe, ...packs];
}

/**
 * Only these ids may be installed, and the id selects a PINNED SCRIPT — never a
 * command string. That is the security boundary: the endpoint cannot be turned
 * into arbitrary command execution by a prompt-injected tool call.
 */
const INSTALLERS: Partial<Record<DependencyId, readonly string[]>> = {
  'whisper-cli': ['scripts/sync-whisper-cli.mjs'],
  mediapipe: ['scripts/sync-mediapipe.mjs'],
};

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

// One install per id at a time: a double-click must not start two downloads
// that both write the same output path.
const inFlight = new Map<DependencyId, Promise<InstallResult>>();

/**
 * Every dependency id the app can report on.
 *
 * Separate from INSTALLERS on purpose: `isDependencyId` answers "is this a real
 * dependency?" and `canInstall` answers "can we provision it?", so a valid id
 * with no installer is rejected with a useful message instead of "unknown id".
 */
const KNOWN_IDS: ReadonlySet<string> = new Set<DependencyId>([
  'ffmpeg', 'whisper-cli', 'whisper-model', 'mediapipe',
  'rhythm-pack', 'music-semantics-pack',
]);

export function isDependencyId(value: unknown): value is DependencyId {
  // Set membership, not `in`: `'constructor' in {}` is true, and an object-based
  // registry would accept inherited prototype keys as ids.
  return typeof value === 'string' && KNOWN_IDS.has(value);
}

/** True when this id has an installer at all (vs. guide-the-user instead). */
export function canInstall(id: DependencyId): boolean {
  // whisper-model is installed in-process from pinned GGML weights (R2 first,
  // then the HF mirrors), so it has no script entry — it must be listed here
  // explicitly or the route reports "not installable" for a working installer.
  if (id === 'whisper-model') return true;
  return Object.hasOwn(INSTALLERS, id) || MODEL_PACK_DEPS.some((entry) => entry.id === id);
}

/**
 * Run the pinned installer for `id`.
 *
 * Resolves (never rejects) with the installer's tail output; callers report the
 * result rather than catching, so the UI always gets a shaped answer.
 */
export async function installDependency(id: DependencyId): Promise<InstallResult> {
  const existing = inFlight.get(id);
  if (existing) return existing;

  // Model packs download in-process (pinned SHA-256 per file, atomic swap). They
  // return as soon as the transfer is RUNNING: a 118 MB download must not hold
  // the request open, and the caller reports progress from the pack catalog.
  const pack = MODEL_PACK_DEPS.find((entry) => entry.id === id);
  if (pack) {
    const attempt = (async (): Promise<InstallResult> => {
      try {
        const { startModelPackDownload } = await import('./plugins/model-packs.ts');
        const task = await startModelPackDownload(pack.packId);
        if (task.status === 'error') {
          return { ok: false, id, output: '', error: task.error ?? 'download failed' };
        }
        return {
          ok: true,
          id,
          output: task.status === 'downloading'
            ? `downloading ${pack.label} (${Math.round(pack.approxBytes / (1024 * 1024))} MB)`
            : `${pack.label} is installed`,
        };
      } catch (error) {
        return { ok: false, id, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    })().finally(() => { inFlight.delete(id); });
    inFlight.set(id, attempt);
    return attempt;
  }

  const script = INSTALLERS[id];
  if (id === 'whisper-model') {
    const attempt = (async (): Promise<InstallResult> => {
      try {
        return await installWhisperModel();
      } catch (error) {
        return { ok: false, id, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    })().finally(() => { inFlight.delete(id); });
    inFlight.set(id, attempt);
    return attempt;
  }
  if (!script || !Object.hasOwn(INSTALLERS, id)) {
    return { ok: false, id, output: '', error: `no installer is registered for "${id}"` };
  }

  const attempt = (async (): Promise<InstallResult> => {
    const result = await run(
      process.execPath,
      [...script, ...[]],
      INSTALL_TIMEOUT_MS,
    );
    const ok = result.code === 0;
    return {
      ok,
      id,
      output: result.output,
      ...(ok ? {} : { error: `installer exited with code ${result.code}` }),
    };
  })().finally(() => { inFlight.delete(id); });

  inFlight.set(id, attempt);
  return attempt;
}

/**
 * Local model pack presence, for the "download required model" affordance.
 * Kept separate from the binary checks because packs are large and optional.
 */
export async function readWhisperModels(): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises');
    return (await readdir(join(ROOT, 'public', 'whisper-cli', 'models')))
      .filter((name) => name.endsWith('.bin'));
  } catch {
    return [];
  }
}

