// Startup preflight for packaged installs.
//
// Every asset checked here is read during boot, before the first window exists:
// the embedded server serves resources/dist, ensureWritableBundle copies
// resources/remotion-bundle into userData, and on Windows ensureRemotionBinaries
// mirrors the static ffmpeg.exe into the compositor's hardware mirror
// (desktop/remotion-binaries.ts). If any of them is gone, boot() rejects
// and main.ts exits — a packaged double-click has no console, so the user sees
// nothing happen at all. That is issue #140: three separate ENOENT/ERR_MODULE
// failures, zero windows, zero dialogs.
//
// An install can lose files without any packaging bug: antivirus quarantines the
// bundled FFmpeg (the app is already reported as a false positive, issue #144),
// or a 650 MB NSIS extraction is interrupted. So name the missing files instead
// of dying silently, and keep the checks pure so they can be verified in Node.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface RuntimeAssetCheck {
  /** Human-readable subject of the check, used in the failure dialog. */
  readonly label: string;
  readonly path: string;
  /** Required assets stop the launch; optional ones only degrade a feature. */
  readonly required: boolean;
}

export interface PackagedAssetInput {
  readonly resourcesPath: string;
  readonly platform: NodeJS.Platform;
  /** Resolved ffmpeg binary (server/media-binaries.ts ffmpegBin()). */
  readonly ffmpegPath: string;
}

export function packagedRuntimeAssetChecks(input: PackagedAssetInput): RuntimeAssetCheck[] {
  const checks: RuntimeAssetCheck[] = [
    { label: '\u7f16\u8f91\u5668\u754c\u9762 / editor UI', path: join(input.resourcesPath, 'dist', 'index.html'), required: true },
    {
      label: '\u6e32\u67d3\u5305 / Remotion render bundle',
      path: join(input.resourcesPath, 'remotion-bundle', 'index.html'),
      required: true,
    },
    {
      label: '\u65e0\u5934\u6e32\u67d3\u6d4f\u89c8\u5668 / headless render browser',
      path: join(input.resourcesPath, 'chrome-headless-shell'),
      required: false,
    },
  ];
  // Only Windows swaps the compositor's ffmpeg for the static build at first
  // launch, so only there does a quarantined ffmpeg.exe block startup.
  if (input.platform === 'win32') {
    checks.push({ label: '\u5185\u7f6e FFmpeg / bundled FFmpeg', path: input.ffmpegPath, required: true });
  }
  return checks;
}

export function missingRuntimeAssets(
  checks: readonly RuntimeAssetCheck[],
  exists: (path: string) => boolean = existsSync,
): RuntimeAssetCheck[] {
  return checks.filter((check) => !exists(check.path));
}

/** Shared by the asset preflight and the entry bundle's load failure. */
export const RUNTIME_ASSET_ADVICE = [
  '\u5e38\u89c1\u539f\u56e0：\u6740\u6bd2\u8f6f\u4ef6\u9694\u79bb\u4e86\u5176\u4e2d\u7684\u6587\u4ef6，\u6216\u5b89\u88c5\u8fc7\u7a0b\u672a\u5b8c\u6210\u3002',
  '\u8bf7\u91cd\u65b0\u5b89\u88c5 AfterFrame；\u82e5\u6587\u4ef6\u518d\u6b21\u6d88\u5931，\u8bf7\u628a\u5b89\u88c5\u76ee\u5f55\u52a0\u5165\u6740\u6bd2\u8f6f\u4ef6\u767d\u540d\u5355\u3002',
  '',
  'Most often antivirus software quarantined part of the install, or the',
  'installer did not finish. Reinstall AfterFrame, and add the installation',
  'directory to your antivirus exclusions if the files disappear again.',
].join('\n');

export function describeMissingRuntimeAssets(missing: readonly RuntimeAssetCheck[]): string {
  const lines = missing.map((check) => `- ${check.label}${check.required ? '' : '（\u53ef\u9009 / optional）'}\n  ${check.path}`);
  return [
    `\u5b89\u88c5\u5305\u7f3a\u5c11 ${missing.length} \u4e2a\u8fd0\u884c\u65f6\u6587\u4ef6 / this install is missing ${missing.length} bundled file(s):`,
    '',
    ...lines,
    '',
    RUNTIME_ASSET_ADVICE,
  ].join('\n');
}

/** The blocking failure text, or null when nothing required is missing. */
export function runtimeAssetFailure(missing: readonly RuntimeAssetCheck[]): string | null {
  return missing.some((check) => check.required) ? describeMissingRuntimeAssets(missing) : null;
}
