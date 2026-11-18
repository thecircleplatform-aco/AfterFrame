// Vault maintenance: relink media that moved, and report media nothing uses.
//
// Two problems this solves, both consequences of media being identified by
// filename while a vault is a folder users may reorganise, back up, or copy:
//
// 1. RELINK. A project stores `src: '/media/uploads/<uuid>.ext'`. If the file is
//    gone (replaced from a backup under a new name, restored into a fresh vault,
//    or renamed by hand) the clip goes offline even though the same bytes are
//    sitting right there. `MediaAsset.sourceContentHash` already exists, so the
//    fix is a hash index: find the file whose SHA-256 matches and copy it back to
//    the expected name. Nothing is guessed by filename similarity.
//
// 2. CLEANUP. With a shared vault, deleting a project leaves its media behind on
//    purpose (another project may use it). That is the right default — deleting a
//    project must never delete a file something else needs — but it lets the
//    folder grow silently. This reports what no project references so the user can
//    remove it deliberately. It never deletes on its own.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, unlink, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeUploadName } from './media-dir.ts';
import { readStore } from './plugins/project-store.ts';

/** Extensions we hash for relinking. Anything else is left alone (transcripts etc.). */
const MEDIA_EXTENSION = /\.(?:mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|avif|heic)$/i;

export interface MediaEntry {
  readonly name: string;
  readonly bytes: number;
  readonly modifiedAt: number;
}

export async function listMediaFiles(mediaDir: string): Promise<MediaEntry[]> {
  let names: string[];
  try {
    names = await readdir(mediaDir);
  } catch {
    return [];
  }
  const entries: MediaEntry[] = [];
  for (const name of names) {
    if (name.startsWith('.') || !MEDIA_EXTENSION.test(name)) continue;
    try {
      const info = await stat(join(mediaDir, name));
      if (!info.isFile()) continue;
      entries.push({ name, bytes: info.size, modifiedAt: info.mtimeMs });
    } catch {
      // A file removed between readdir and stat is simply not there.
    }
  }
  return entries;
}

async function sha256File(path: string): Promise<string | null> {
  try {
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/** Every `/media/uploads/<name>` reference and the content hash recorded for it. */
interface AssetReference {
  readonly projectId: string;
  readonly name: string;
  readonly hash: string | null;
}

/**
 * How the reference set is obtained.
 *
 * Injectable so the verification can drive these functions against a synthetic
 * project store instead of the user's real SQLite database — the alternative is a
 * test that mutates real projects to prove a delete is safe, which is exactly
 * the risk these functions exist to avoid.
 */
export type ReferenceSource = () => Promise<Record<string, unknown>>;

const defaultReferenceSource: ReferenceSource = async () => (await readStore()).entries;

/**
 * Collect asset references from every stored project.
 *
 * Reads the raw documents rather than the editor's normalized types: the
 * cleanup/relink path must see what is actually on disk, including projects that
 * are currently undeletable or were written by an older build.
 */
async function collectReferences(source: ReferenceSource = defaultReferenceSource): Promise<AssetReference[]> {
  const entries = await source();
  const references: AssetReference[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith('project:')) continue;
    const projectId = key.slice('project:'.length);
    const doc = value as { assets?: unknown } | null;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.assets)) continue;
    for (const asset of doc.assets) {
      if (!asset || typeof asset !== 'object') continue;
      const record = asset as Record<string, unknown>;
      const src = typeof record.src === 'string' ? record.src : '';
      const prefix = '/media/uploads/';
      if (!src.startsWith(prefix)) continue;
      const name = src.slice(prefix.length).split(/[?#]/, 1)[0] ?? '';
      if (!isSafeUploadName(name)) continue;
      const hash = typeof record.sourceContentHash === 'string' ? record.sourceContentHash.toLowerCase() : null;
      references.push({ projectId, name, hash });
    }
  }
  return references;
}

export interface RelinkCandidate {
  readonly expectedName: string;
  readonly foundName: string;
  readonly hash: string;
  readonly projectIds: readonly string[];
  readonly bytes: number;
}

export interface RelinkReport {
  /** References whose file is already present — nothing to do. */
  readonly present: number;
  /** Missing files that can be restored by hash. */
  readonly recoverable: readonly RelinkCandidate[];
  /** Missing files with no hash on record, or no matching bytes in the vault. */
  readonly unrecoverable: readonly { readonly name: string; readonly projectIds: readonly string[] }[];
  /** Names referenced but missing, counted once per distinct name. */
  readonly missingCount: number;
}

/**
 * Work out what a relink would do, without writing anything.
 *
 * Separate from applying so the UI can show a confirmation with exact counts: a
 * relink writes files, and copying the wrong bytes over a name is worse than
 * leaving it offline.
 */
export async function planRelink(
  mediaDir: string,
  source: ReferenceSource = defaultReferenceSource,
): Promise<RelinkReport> {
  const [files, references] = await Promise.all([listMediaFiles(mediaDir), collectReferences(source)]);
  const present = new Set(files.map((file) => file.name));

  const byName = new Map<string, { hashes: Set<string>; projectIds: Set<string> }>();
  for (const reference of references) {
    const entry = byName.get(reference.name) ?? { hashes: new Set<string>(), projectIds: new Set<string>() };
    if (reference.hash) entry.hashes.add(reference.hash);
    entry.projectIds.add(reference.projectId);
    byName.set(reference.name, entry);
  }

  const missing = [...byName].filter(([name]) => !present.has(name));

  // Index the vault by hash only for files that are actually on disk. Hashing is
  // O(bytes), so this is done once per plan and reused for every missing name.
  const hashOf = new Map<string, string>();
  const namesByHash = new Map<string, string[]>();
  for (const file of files) {
    const hash = await sha256File(join(mediaDir, file.name));
    if (!hash) continue;
    hashOf.set(file.name, hash);
    namesByHash.set(hash, [...(namesByHash.get(hash) ?? []), file.name]);
  }

  const recoverable: RelinkCandidate[] = [];
  const unrecoverable: { name: string; projectIds: string[] }[] = [];
  for (const [name, entry] of missing) {
    let match: { hash: string; foundName: string } | null = null;
    for (const hash of entry.hashes) {
      const candidates = (namesByHash.get(hash) ?? []).filter((file) => file !== name);
      // Prefer a file that no project references by name. Copying FROM a file
      // that is itself a live reference means the restored copy is only as safe
      // as that file staying put; a stray duplicate is the better source, and any
      // match is byte-identical anyway because it is selected by SHA-256.
      const preferred = candidates.find((file) => !byName.has(file)) ?? candidates[0];
      if (preferred) { match = { hash, foundName: preferred }; break; }
    }
    if (!match) {
      unrecoverable.push({ name, projectIds: [...entry.projectIds] });
      continue;
    }
    const bytes = files.find((file) => file.name === match!.foundName)?.bytes ?? 0;
    recoverable.push({
      expectedName: name,
      foundName: match.foundName,
      hash: match.hash,
      projectIds: [...entry.projectIds],
      bytes,
    });
  }

  return {
    // Distinct file names whose bytes are already on disk — the count a user
    // would compare against "missing".
    present: [...byName.keys()].filter((name) => present.has(name)).length,
    recoverable,
    unrecoverable,
    missingCount: missing.length,
  };
}

export interface RelinkResult {
  readonly restored: readonly { readonly expectedName: string; readonly from: string }[];
  readonly failed: readonly { readonly expectedName: string; readonly error: string }[];
}

/** Apply a plan. Re-verifies each source hash immediately before copying. */
export async function applyRelink(
  mediaDir: string,
  candidates: readonly RelinkCandidate[],
): Promise<RelinkResult> {
  const restored: { expectedName: string; from: string }[] = [];
  const failed: { expectedName: string; error: string }[] = [];
  for (const candidate of candidates) {
    // Refuse names that could escape the directory, even though they came from
    // our own store: a project document is user-writable data.
    if (!isSafeUploadName(candidate.expectedName) || !isSafeUploadName(candidate.foundName)) {
      failed.push({ expectedName: candidate.expectedName, error: 'unsafe file name' });
      continue;
    }
    const source = join(mediaDir, candidate.foundName);
    const target = join(mediaDir, candidate.expectedName);
    // Re-hash: the plan may have been produced minutes ago, and copying a file
    // that changed since then would attach the wrong bytes to the wrong clip.
    const current = await sha256File(source);
    if (current !== candidate.hash) {
      failed.push({ expectedName: candidate.expectedName, error: 'source bytes changed since the plan was made' });
      continue;
    }
    try {
      await copyFile(source, target);
      restored.push({ expectedName: candidate.expectedName, from: candidate.foundName });
    } catch (error) {
      failed.push({ expectedName: candidate.expectedName, error: String(error) });
    }
  }
  return { restored, failed };
}

/**
 * Delete specific unreferenced files.
 *
 * Takes an explicit name list rather than "everything unused": the caller must
 * echo back what the user was shown, so a project saved between the report and
 * the delete cannot lose media that just became referenced. Each name is
 * re-checked against a FRESH reference set immediately before unlinking.
 */
export async function deleteUnusedMedia(
  mediaDir: string,
  names: readonly string[],
  source: ReferenceSource = defaultReferenceSource,
): Promise<{ deleted: string[]; kept: { name: string; reason: string }[] }> {
  const references = await collectReferences(source);
  const used = new Set(references.map((reference) => reference.name));
  const deleted: string[] = [];
  const kept: { name: string; reason: string }[] = [];
  for (const name of names) {
    if (!isSafeUploadName(name)) { kept.push({ name, reason: 'unsafe file name' }); continue; }
    if (used.has(name)) { kept.push({ name, reason: 'referenced by a project' }); continue; }
    try {
      await unlink(join(mediaDir, name));
      deleted.push(name);
    } catch (error) {
      kept.push({ name, reason: String(error) });
    }
  }
  return { deleted, kept };
}

export interface UnusedMediaReport {
  readonly files: readonly MediaEntry[];
  readonly totalBytes: number;
  /** Referenced names that are missing from disk; never treated as "unused". */
  readonly missingReferences: number;
}

/**
 * Files in the vault that no project references.
 *
 * Notes on correctness:
 * - A name still counts as used if ANY project references it, including projects
 *   that are soft-deleted but recoverable, so restoring a project cannot find its
 *   media already swept.
 * - Derived files (`<id>.asr.ogg`, normalized proxies) are matched by their own
 *   name via the same reference list; anything unreferenced is reported, not
 *   deleted.
 */
export async function findUnusedMedia(
  mediaDir: string,
  source: ReferenceSource = defaultReferenceSource,
): Promise<UnusedMediaReport> {
  const [files, references] = await Promise.all([listMediaFiles(mediaDir), collectReferences(source)]);
  const used = new Set(references.map((reference) => reference.name));
  const unused = files.filter((file) => !used.has(file.name));
  const present = new Set(files.map((file) => file.name));
  return {
    files: unused,
    totalBytes: unused.reduce((total, file) => total + file.bytes, 0),
    missingReferences: references.filter((reference) => !present.has(reference.name)).length,
  };
}
