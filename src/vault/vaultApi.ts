// Client for /api/vault — the user's project + media folder on their device.
//
// Every call here is explicit (nothing polls, nothing runs on load). The report
// endpoints are separate from the apply endpoints on purpose: both relinking and
// cleanup write or delete files, so the UI always shows a counted confirmation
// before the user can commit.

const BASE = '/api/vault';

export interface VaultStatus {
  /** Where media is stored right now. */
  readonly mediaDir: string;
  /** The folder the user chose, or null when they never chose one. */
  readonly chosenPath: string | null;
  readonly activeRoot: string;
  readonly state: 'none' | 'vault' | 'invalid';
  readonly marker?: { readonly formatVersion: number; readonly createdAt: number };
  readonly reason?: string;
  readonly suggestedPath: string;
  /** True when the chosen folder is a real, marked vault (safe to rely on). */
  readonly portable: boolean;
  /** A folder was recorded but never initialised — setup still needs to run. */
  readonly chosenNeedsSetup?: boolean;
}

export interface RelinkCandidate {
  readonly expectedName: string;
  readonly foundName: string;
  readonly hash: string;
  readonly projectIds: readonly string[];
  readonly bytes: number;
}

export interface RelinkReport {
  readonly present: number;
  readonly recoverable: readonly RelinkCandidate[];
  readonly unrecoverable: readonly { readonly name: string; readonly projectIds: readonly string[] }[];
  readonly missingCount: number;
}

export interface UnusedMediaReport {
  readonly files: readonly { readonly name: string; readonly bytes: number; readonly modifiedAt: number }[];
  readonly totalBytes: number;
  readonly missingReferences: number;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(body?.error ?? `request failed (HTTP ${response.status})`);
  }
  if (!body) throw new Error('the server returned an empty response');
  return body;
}

export async function readVaultStatus(): Promise<VaultStatus> {
  return readJson<VaultStatus>(await fetch(BASE, { cache: 'no-store' }));
}

export interface VaultInitResult {
  readonly ok: boolean;
  readonly root: string;
  readonly created: boolean;
  /** The active profile resolved at startup, so a new folder applies next launch. */
  readonly restartRequired: boolean;
}

/** Create (or adopt) a vault at `path` and remember it for the next launch. */
export async function initVault(path: string): Promise<VaultInitResult> {
  return readJson<VaultInitResult>(await fetch(`${BASE}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  }));
}

export async function planRelink(): Promise<RelinkReport> {
  return readJson<RelinkReport>(await fetch(`${BASE}/relink`, { cache: 'no-store' }));
}

export interface RelinkResult {
  readonly ok: boolean;
  readonly restored: readonly { readonly expectedName: string; readonly from: string }[];
  readonly failed: readonly { readonly expectedName: string; readonly error: string }[];
}

/** Restore the given candidates. Omitting them re-plans server-side. */
export async function applyRelink(
  candidates?: readonly RelinkCandidate[],
): Promise<RelinkResult> {
  return readJson<RelinkResult>(await fetch(`${BASE}/relink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candidates ? { candidates } : {}),
  }));
}

export async function readUnusedMedia(): Promise<UnusedMediaReport> {
  return readJson<UnusedMediaReport>(await fetch(`${BASE}/unused`, { cache: 'no-store' }));
}

export interface DeleteUnusedResult {
  readonly deleted: readonly string[];
  readonly kept: readonly { readonly name: string; readonly reason: string }[];
}

/** Delete the exact names the user was shown. */
export async function deleteUnusedMedia(names: readonly string[]): Promise<DeleteUnusedResult> {
  return readJson<DeleteUnusedResult>(await fetch(`${BASE}/unused/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  }));
}

/** Human-readable byte size for the counts shown in the panel. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
