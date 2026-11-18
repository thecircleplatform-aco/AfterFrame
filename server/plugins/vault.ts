// /api/vault — the user's media/project folder on their own device.
//
//   GET  /api/vault                  → where it is, whether it is initialised
//   POST /api/vault/init             → { path } create or adopt a folder
//   GET  /api/vault/relink           → dry run: what could be restored
//   POST /api/vault/relink           → apply the restore
//   GET  /api/vault/unused           → media no project references
//   POST /api/vault/unused/delete    → { names } remove the ones shown
//
// Every mutating route is a deliberate user action; nothing here runs on load.
// The relink and cleanup routes are split into "report" and "apply" so the UI can
// always show exact counts before anything is written or deleted.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { readDataDirPointer, writeDataDirPointer } from '../data-dir.ts';
import { uploadDir } from '../media-dir.ts';
import { runtimeProfile } from '../runtime-profile.ts';
import {
  applyRelink, deleteUnusedMedia, findUnusedMedia, planRelink,
  type RelinkCandidate,
} from '../vault-maintenance.ts';
import {
  defaultVaultPath, initVault, inspectVault, resolveVaultPath, VAULT_LAYOUT,
} from '../vault.ts';
import { relocateDatabaseToVault, vaultHoldsProjectDatabase } from '../vault-store.ts';
import {
  closeSqliteStore, configureSqliteStorePath, storePath,
} from '../storage/sqlite-store.ts';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_DELETE_NAMES = 5_000;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** The folder that currently holds this session's media. */
function activeMediaDir(): string {
  return uploadDir(runtimeProfile());
}

async function handleStatus(res: ServerResponse): Promise<void> {
  const configured = readDataDirPointer();
  const mediaDir = activeMediaDir();
  // Report the ACTIVE state, not the pointer: with no pointer the app uses the
  // default root, and telling the UI "no vault" while media is clearly being
  // stored somewhere would be misleading.
  const activeVault = await inspectVault(runtimeProfile().rootDir);
  // A pointer alone does NOT make a vault. If the chosen folder has no marker it
  // was recorded but never initialised (an interrupted setup, a hand-edited
  // pointer, or a folder deleted and recreated), so the user still needs setup.
  const chosenVault = configured ? await inspectVault(configured) : null;
  const chosenIsVault = chosenVault?.kind === 'vault';
  sendJson(res, 200, {
    mediaDir,
    // Where the user chose to keep things, or null when they never chose.
    chosenPath: configured,
    activeRoot: runtimeProfile().rootDir,
    state: activeVault.kind,
    ...(activeVault.kind === 'vault'
      ? { marker: activeVault.marker }
      : activeVault.kind === 'invalid'
        ? { reason: activeVault.reason }
        : {}),
    suggestedPath: defaultVaultPath(),
    portable: chosenIsVault,
    // Distinguishes "never chose" from "chose but setup did not finish", so the UI
    // can re-offer setup instead of silently claiming the folder is in use.
    chosenNeedsSetup: configured !== null && !chosenIsVault,
    // Where the project database actually lives, and whether it is inside the
    // vault. An empty `project-store-v1/` directory used to imply the vault owned
    // the projects while it owned nothing, so both are reported explicitly.
    projectDatabasePath: storePath(),
    projectDatabaseInVault: chosenIsVault
      ? await vaultHoldsProjectDatabase(configured!, VAULT_LAYOUT.database)
      : false,
  });
}

async function handleInit(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  if (!body) { sendJson(res, 400, { error: 'body must be a JSON object' }); return; }
  const raw = typeof body.path === 'string' ? body.path : '';
  const root = resolveVaultPath(raw);
  if (!root) {
    sendJson(res, 400, { error: 'path must be an absolute folder path (a leading ~/ is allowed)' });
    return;
  }
  const outcome = await initVault(root);
  if (!outcome.ok) { sendJson(res, 409, { error: outcome.error }); return; }

  // Record the choice. The active profile resolved at startup, so this takes
  // effect on the next launch — the SAME limitation the settings field has, and
  // it is reported rather than hidden so the UI can say "restart to move".
  await writeDataDirPointer(root);
  sendJson(res, 200, {
    ok: true,
    root: outcome.root,
    created: outcome.created,
    restartRequired: root !== runtimeProfile().rootDir,
  });
}

async function handleRelinkPlan(res: ServerResponse): Promise<void> {
  const report = await planRelink(activeMediaDir());
  sendJson(res, 200, report);
}

/**
 * Copy the ACTIVE project database into the vault.
 *
 * Split from `/init` on purpose: choosing a folder and moving the database are
 * two different decisions, and the second one moves every project the user has.
 * The caller sees exact counts before it happens (`GET` = inspect, `POST` =
 * apply), and the source database is never deleted — it remains as a backup.
 *
 * Runs only for the active (non-isolated) profile. An anything-else caller must
 * not be able to redirect a checkout's storage into a machine-wide vault.
 */
async function handleProjectMigratePlan(res: ServerResponse): Promise<void> {
  const configured = readDataDirPointer();
  const vault = configured ? await inspectVault(configured) : null;
  const isVault = vault?.kind === 'vault';
  const source = storePath();
  sendJson(res, 200, {
    ready: isVault,
    ...(isVault ? {} : { reason: 'the chosen folder is not an initialised vault yet' }),
    sourcePath: source,
    destinationPath: isVault ? join(configured!, VAULT_LAYOUT.database) : null,
    destinationAlreadyHasProjects: isVault
      ? await vaultHoldsProjectDatabase(configured!, VAULT_LAYOUT.database)
      : false,
  });
}

async function handleProjectMigrateApply(res: ServerResponse): Promise<void> {
  const configured = readDataDirPointer();
  const vault = configured ? await inspectVault(configured) : null;
  if (vault?.kind !== 'vault') {
    sendJson(res, 409, { error: 'choose and initialise a vault folder first' });
    return;
  }
  const source = storePath();
  const destination = join(configured!, VAULT_LAYOUT.database);
  if (source === destination) {
    sendJson(res, 200, { ok: true, kind: 'already-there', path: destination });
    return;
  }
  // Close first: SQLite checkpoints the WAL on close, so only then is the file
  // on disk complete. Copying a live database would silently drop recent writes.
  closeSqliteStore();
  const outcome = await relocateDatabaseToVault({ from: source, to: destination });
  if (outcome.kind === 'copied' || outcome.kind === 'already-there') {
    // Point this process at the vault copy so the editor keeps working without a
    // restart. A fresh launch resolves the same path from the pointer.
    configureSqliteStorePath(destination);
  } else {
    // Nothing moved: reopen the original so the app is not left storeless.
    configureSqliteStorePath(null);
  }
  sendJson(res, outcome.kind === 'failed' ? 500 : 200, {
    ...outcome,
    ok: outcome.kind !== 'failed' && outcome.kind !== 'destination-occupied',
    activeDatabasePath: storePath(),
    sourceKept: true,
  });
}

async function handleRelinkApply(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  if (!body) { sendJson(res, 400, { error: 'body must be a JSON object' }); return; }
  const mediaDir = activeMediaDir();
  let candidates: RelinkCandidate[];
  if (Array.isArray(body.candidates)) {
    // Trust only the identifying fields; the hash and source are re-verified
    // inside applyRelink against the real bytes on disk.
    candidates = body.candidates.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      if (typeof record.expectedName !== 'string' || typeof record.foundName !== 'string'
        || typeof record.hash !== 'string') return [];
      return [{
        expectedName: record.expectedName,
        foundName: record.foundName,
        hash: record.hash.toLowerCase(),
        projectIds: [],
        bytes: 0,
      }];
    });
  } else {
    // No explicit list: recompute, so a stale client cannot request arbitrary copies.
    const report = await planRelink(mediaDir);
    candidates = [...report.recoverable];
  }
  const result = await applyRelink(mediaDir, candidates);
  sendJson(res, 200, { ok: result.failed.length === 0, ...result });
}

async function handleUnusedReport(res: ServerResponse): Promise<void> {
  const report = await findUnusedMedia(activeMediaDir());
  sendJson(res, 200, report);
}

async function handleUnusedDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  if (!body) { sendJson(res, 400, { error: 'body must be a JSON object' }); return; }
  if (!Array.isArray(body.names) || body.names.length === 0) {
    sendJson(res, 400, { error: 'names must be a non-empty array' });
    return;
  }
  if (body.names.length > MAX_DELETE_NAMES) {
    sendJson(res, 400, { error: `at most ${MAX_DELETE_NAMES} names per request` });
    return;
  }
  const names = body.names.filter((name): name is string => typeof name === 'string');
  const result = await deleteUnusedMedia(activeMediaDir(), names);
  sendJson(res, 200, result);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname === '/' ? '' : url.pathname;
  try {
    if (path === '' && req.method === 'GET') { await handleStatus(res); return; }
    if (path === '/init' && req.method === 'POST') { await handleInit(req, res); return; }
    if (path === '/relink' && req.method === 'GET') { await handleRelinkPlan(res); return; }
    if (path === '/relink' && req.method === 'POST') { await handleRelinkApply(req, res); return; }
    if (path === '/projects' && req.method === 'GET') { await handleProjectMigratePlan(res); return; }
    if (path === '/projects' && req.method === 'POST') { await handleProjectMigrateApply(res); return; }
    if (path === '/unused' && req.method === 'GET') { await handleUnusedReport(res); return; }
    if (path === '/unused/delete' && req.method === 'POST') { await handleUnusedDelete(req, res); return; }
    sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function vaultPlugin(): Plugin {
  return {
    name: 'afterframe-vault',
    configureServer(server) {
      server.middlewares.use('/api/vault', (req: IncomingMessage, res: ServerResponse) => {
        void handle(req, res);
      });
    },
  };
}
