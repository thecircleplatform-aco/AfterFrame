import {
  advanceBrowserProjectOwnership,
  browserProjectOwnership,
  projectStoreRemoteAvailable,
  projectStoreWriteCredential,
  requestProjectStore,
  resetProjectStoreTransport,
  waitForBrowserProjectOwnership,
} from './projectStoreTransport';
import type {
  ProjectStoreMutationResponse,
  ProjectDocumentMutationResponse,
  ProjectStoreRequest,
} from '../../shared/project-store-transport';
import { projectIdFromProjectStoreKey } from '../../shared/project-store-validation';
import {
  configureLocalKvBackend, freshCache, hasIdb, injectedBackend,
  localDel, localGet, localKeys, localSet, resetLocalKvMemory,
  type SharedKvBackend,
} from './sharedKvLocal';
import {
  acknowledgePendingKeys, clearPendingKey, isProjectDocumentKey,
  loadPendingKeys, localEntries, locallyPendingKeys, markPendingKey,
  MIGRATION_KEY, PENDING_KEYS_KEY,
} from './sharedKvPending';
import { recoverUnmergedProjects } from './sharedKvRecovery';
import {
  requestEntry, requestMerge, requestMutation, requestProjectDocumentMutation,
  requestSnapshot, validMutationResponse, type EntryResponse,
} from './sharedKvRequests';

/**
 * A save that was rejected because the stored revision moved on.
 *
 * Distinct from a transient transport failure on purpose: retrying can never
 * succeed, so callers must not present it as "try again" or silently keep
 * queueing writes. The editor uses this to surface a reload prompt instead of a
 * vague toast, because the failure mode is invisible data loss — the user keeps
 * editing a document that is never persisted.
 */
export class ProjectSaveConflictError extends Error {
  readonly code = 'project_save_conflict';
  /** True: the only recovery is a reload, not a retry. */
  readonly requiresReload = true;
  constructor(message: string) {
    super(message);
    this.name = 'ProjectSaveConflictError';
  }
}
export type { SharedKvBackend } from './sharedKvLocal';
type AgentRuntimeWriteRequest = Extract<ProjectStoreRequest, { operation: 'agent-runtime-write' }>;
type AgentRunLeaseRequest = Extract<ProjectStoreRequest, { operation: 'agent-run-lease' }>;
type ProjectDocumentWriteRequest = Extract<ProjectStoreRequest, { operation: 'project-document-write' }>;
let remoteCache: Record<string, unknown> | null = null;
// Keys whose last write could not reach the server (offline/read-only):
// remote reads must never purge their local copy, or the only data copy
// is silently deleted on the next load.
const remoteKnown = new Set<string>();
let readyPromise: Promise<void> | undefined;
let projectMigrationPending = false;
const canSync = (): boolean => !injectedBackend && projectStoreRemoteAvailable();
export function configureSharedKvBackend(backend: SharedKvBackend | undefined): void {
  configureLocalKvBackend(backend);
  remoteCache = null;
  remoteKnown.clear();
  locallyPendingKeys.clear();
  projectMigrationPending = false;
  readyPromise = undefined;
}
function cacheEntry(key: string, entry: EntryResponse): void {
  remoteKnown.add(key);
  remoteCache = entry.found
    ? { ...remoteCache, [key]: entry.value }
    : Object.fromEntries(Object.entries(remoteCache ?? {}).filter(([name]) => name !== key));
}
async function fetchRemoteEntry(key: string): Promise<void> {
  const entry = await requestEntry(key);
  if (locallyPendingKeys.has(key) || (key === 'projects' && projectMigrationPending)) {
    const local = await localGet(key);
    remoteKnown.add(key);
    if (local === undefined) delete remoteCache?.[key];
    else if (remoteCache) remoteCache = { ...remoteCache, [key]: local };
    return;
  }
  cacheEntry(key, entry);
  if (entry.found) {
    await localSet(key, entry.value);
  } else {
    await localDel(key);
  }
}
async function cacheMutation(key: string, result: ProjectStoreMutationResponse): Promise<void> {
  cacheEntry(key, result);
  if (result.found) await localSet(key, result.value);
  else await localDel(key);
}
export async function kvWriteAgentRuntime(
  request: AgentRuntimeWriteRequest,
): Promise<ProjectStoreMutationResponse> {
  await ready();
  const remote = !injectedBackend && canSync();
  const result = injectedBackend
    ? await injectedBackend.writeAgentRuntime(request)
    : remote
      ? await requestMutation(request)
      : await localAgentRuntimeWrite(request);
  if (!validMutationResponse(result)) throw new Error('invalid agent runtime CAS response');
  if (remote) await cacheMutation(request.key, result);
  return result;
}
async function localAgentRuntimeWrite(
  request: AgentRuntimeWriteRequest,
): Promise<ProjectStoreMutationResponse> {
  // CAS removed: local writes are serialized by the caller's enqueue/lock;
  // the expected revision is no longer compared.
  await localSet(request.key, request.value);
  return { accepted: true, found: true, value: request.value };
}

export async function kvUpdateAgentRunLease(
  request: AgentRunLeaseRequest,
): Promise<ProjectStoreMutationResponse | null> {
  await ready();
  if (!injectedBackend && !canSync()) return null;
  const result = injectedBackend
    ? await injectedBackend.updateAgentRunLease(request)
    : await requestMutation(request);
  if (!validMutationResponse(result)) throw new Error('invalid agent run lease response');
  if (!injectedBackend) await cacheMutation(request.key, result);
  return result;
}

async function bootstrap(): Promise<void> {
  if (!canSync()) return;
  let projects: EntryResponse;
  try {
    await loadPendingKeys();
    const migrated = await localGet<boolean>(MIGRATION_KEY);
    projects = await requestEntry('projects');
    const canWrite = projectStoreWriteCredential();
    let mergeFailed = false;
    if ((!migrated || !projects.found || locallyPendingKeys.size > 0) && canWrite) {
      try {
        const local = await localEntries();
        const result = await recoverUnmergedProjects(
          local, await requestMerge(local, [...locallyPendingKeys].filter(isProjectDocumentKey)),
          locallyPendingKeys,
          (entries) => requestMerge(entries, Object.keys(entries).filter(isProjectDocumentKey)),
          requestEntry,
        );
        const { snapshot } = result;
        projects = 'projects' in snapshot.entries
          ? { found: true, value: snapshot.entries.projects }
          : { found: false };
        await acknowledgePendingKeys(local, snapshot.entries, result.recovered);
      } catch {
        // Merge failure (lease contention, transient 5xx, timeout): keep the
        // remote cache usable for reads and retry the merge on a later load.
        // When a local 'projects' entry exists it must stay authoritative —
        // a failed merge is never allowed to fall through to the sync-down
        // branch below, which would overwrite it (or, with an empty remote
        // library, delete the only copy of the local project index).
        mergeFailed = (await localGet<unknown>('projects')) !== undefined;
      }
    }
    projectMigrationPending = locallyPendingKeys.has('projects') || mergeFailed || (!canWrite
      && (!projects.found || (Array.isArray(projects.value) && projects.value.length === 0)));
  } catch {
    await disableRemote();
    return;
  }
  remoteCache = {};
  remoteKnown.clear();
  cacheEntry('projects', projects);
  if (projectMigrationPending) {
    await localDel(MIGRATION_KEY);
    return;
  }
  if (projects.found) await localSet('projects', projects.value);
  else await localDel('projects');
  await localSet(MIGRATION_KEY, true);
}

async function ready(): Promise<void> {
  readyPromise ??= bootstrap();
  await readyPromise;
}

async function disableRemote(): Promise<void> {
  remoteCache = null;
  remoteKnown.clear();
  try {
    await localDel(MIGRATION_KEY);
  } catch {
    // Local writes remain usable; the next successful page load can retry migration.
  }
}

// Fresh reads hit the network, but a short TTL cache absorbs repeated reads
// within one hydration (currentAgentSessionGeneration is consulted by
// loadChat, the runtime sidecar and the recovery chain).
const FRESH_CACHE_TTL_MS = 2_000;
// kvGet serves known keys from the in-memory remote cache; re-verify them
// against the server on a short TTL so a second port/instance that wrote
// newer data is not hidden forever (read-modify-write flows would then
// overwrite the newer remote value).
const KV_REMOTE_VERIFY_TTL_MS = 5_000;
const remoteVerifiedAt = new Map<string, number>();

export async function kvGetFresh<T>(key: string): Promise<T | undefined> {
  await ready();
  // Session generation is the cross-port cutover fence. It must observe an
  // external clear before a new run writes, so never serve it from the TTL
  // cache. Other fresh reads retain the hydration round-trip optimization.
  const cacheGeneration = !key.startsWith('agent-session-generation:');
  const cached = cacheGeneration ? freshCache.get(key) : undefined;
  if (cached && Date.now() - cached.at < FRESH_CACHE_TTL_MS) {
    return cached.value as T | undefined;
  }
  if (!injectedBackend && projectStoreRemoteAvailable()) {
    try {
      await fetchRemoteEntry(key);
    } catch {
      // Remote momentarily unreachable (bootstrap may have failed the same
      // way): serve the local copy instead of failing hydration.
      await disableRemote();
    }
    if (remoteCache) {
      const value = remoteCache[key] as T | undefined;
      if (cacheGeneration) freshCache.set(key, { value, at: Date.now() });
      return value;
    }
  }
  const value = await localGet<T>(key);
  if (cacheGeneration) freshCache.set(key, { value, at: Date.now() });
  return value;
}
/** Local-first read for per-machine session data (chat history, agent
 *  runtime sidecar): return the local copy immediately and refresh the
 *  remote cache in the background. Cross-port consistency for these keys is
 *  best-effort — they are regenerated by the editor, not shared documents. */
export async function kvGetLocalFirst<T>(key: string): Promise<T | undefined> {
  await ready();
  const local = await localGet<T>(key);
  if (!injectedBackend && remoteCache && !remoteKnown.has(key)) {
    void fetchRemoteEntry(key).catch(() => undefined);
  }
  return local ?? (remoteCache?.[key] as T | undefined);
}

export async function kvAdoptAuthoritativeValue(key: string, value: unknown): Promise<void> {
  await localSet(key, value);
  remoteKnown.add(key);
  remoteCache = { ...(remoteCache ?? {}), [key]: value };
}

export function kvForgetCachedAgentSessionEntries(projectId: string): void {
  const isSessionEntry = (key: string): boolean =>
    projectIdFromProjectStoreKey(key) === projectId
    && /^(?:chat:|proposal:|agent-runtime:|agent-artifact:|agent-session-(?:chat|proposal|runtime|artifact):)/.test(key);
  for (const key of remoteKnown) {
    if (isSessionEntry(key)) remoteKnown.delete(key);
  }
  // Never turn a null remoteCache into an empty object: {} is truthy and
  // makes later kvSet/kvGet take the remote branch (and fail) in
  // environments that never bootstrapped a remote store.
  remoteCache = remoteCache === null
    ? null
    : Object.fromEntries(Object.entries(remoteCache).filter(([key]) => !isSessionEntry(key)));
  for (const key of [...freshCache.keys()]) {
    if (isSessionEntry(key)) freshCache.delete(key);
  }
}

/**
 * Schedule a verification read without blocking the caller.
 *
 * Every `await fetchRemoteEntry` here is a full HTTP round-trip, and the chat
 * panel issues ~20 of these on mount (chat, agent-runtime, jobs, proposal,
 * creative-mode, artifacts...). Because each hook awaited its own read, those
 * round-trips were effectively SERIALIZED: opening the Agent panel took ~4s
 * while the actual server time was a few milliseconds per entry.
 *
 * Reads now return the cached value immediately and refresh in the background.
 * `kvGetFresh` below keeps the strictly-awaited form for callers that genuinely
 * need the server's answer before acting (e.g. ownership/CAS decisions).
 */
function scheduleRemoteVerify(key: string): void {
  if (!remoteCache) return;
  const lastVerified = remoteVerifiedAt.get(key) ?? 0;
  if (!(key === 'projects' || !remoteKnown.has(key)
    || Date.now() - lastVerified > KV_REMOTE_VERIFY_TTL_MS)) return;
  // Claim the slot synchronously so a burst of concurrent kvGet calls for the
  // same key coalesces into ONE request instead of a stampede.
  remoteVerifiedAt.set(key, Date.now());
  void fetchRemoteEntry(key).catch(() => undefined);
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  await ready();
  if (remoteCache) {
    // Serve from cache first. `remoteKnown` means the remote copy was already
    // folded into the cache, so a background refresh is sufficient to keep it
    // current; an unknown key has nothing local to return, so it must await.
    const cached = remoteCache[key] as T | undefined;
    const known = remoteKnown.has(key);
    if (known && key !== 'projects' && cached !== undefined) {
      scheduleRemoteVerify(key);
      return cached;
    }
    try {
      await fetchRemoteEntry(key);
      remoteVerifiedAt.set(key, Date.now());
    } catch {
      await disableRemote();
    }
  }
  if (remoteCache) return remoteCache[key] as T | undefined;
  return localGet<T>(key);
}



async function setProjectDocument(key: string, value: unknown): Promise<void> {
  if (injectedBackend || !canSync()) {
    await localSet(key, value);
    if (!injectedBackend) await markPendingKey(key);
    return;
  }
  if (!remoteCache) {
    // The remote bootstrap failed (desktop IPC / server briefly unreachable).
    // Fall back to a local write marked as pending so a later successful
    // bootstrap merge carries it into the shared store — the same offline
    // semantics as kvGet's local read fallback. Never hard-fail the editor.
    await localSet(key, value);
    await markPendingKey(key);
    return;
  }
  const projectId = key.slice('project:'.length);
  let ownership = browserProjectOwnership(projectId);
  const local = await localGet<unknown>(key);
  if (!ownership && local !== undefined) {
    ownership = await waitForBrowserProjectOwnership(projectId);
    if (!ownership) {
      // No edit rights yet. The bridge registers them, and it can legitimately
      // still be starting (hydration, reconnect backoff, a rejection it is
      // already retrying). Refusing the save here is what turned a transient
      // registration delay into permanent data loss: the write was dropped, the
      // tab fell further behind, and the user's imports existed only in memory.
      //
      // Keep the edit locally and mark it pending instead. The pending-key
      // merge carries it into the shared store once ownership arrives, so a
      // slow registration delays persistence rather than discarding it.
      await localSet(key, value);
      await markPendingKey(key);
      return;
    }
  }
  const request: ProjectDocumentWriteRequest = ownership
    ? {
      operation: 'project-document-write',
      key,
      expectedRevision: ownership.baseRevision,
      ownerId: ownership.ownerId,
      ownershipEpoch: ownership.epoch,
      value,
    }
    : { operation: 'project-document-write', key, expectedRevision: null, value };
  let result: ProjectDocumentMutationResponse;
  try {
    result = await requestProjectDocumentMutation(request);
  } catch (error) {
    await disableRemote();
    throw error;
  }
  if (!result.accepted) {
    await cacheMutation(key, result);
    // A rejected CAS means this tab's base revision is behind the stored one.
    // Something else wrote the project — another window, the agent, a restore, or
    // a stale ownership record left by an earlier session.
    //
    // Adopt the revision the server just reported. Without this the tab stays
    // pinned to a revision that can never match again, so EVERY subsequent save
    // fails while the user keeps importing — and a refresh then discards all of
    // it. Re-basing makes the next autosave land instead of looping on failure;
    // the in-memory document is the newer intent in a single-user editor, which
    // is the only shape this app supports.
    const rebased = ownership && typeof result.currentRevision === 'string'
      ? advanceBrowserProjectOwnership(ownership, result.currentRevision)
      : undefined;
    throw new ProjectSaveConflictError(
      'Your last change was not saved because this project was changed somewhere else after this tab loaded it. '
      + (rebased
        ? 'AfterFrame re-attached to the current version, so the next change will save normally.'
        : 'Reload the page to reattach, then redo your last change.'),
    );
  }
  if (!result.found || typeof result.currentRevision !== 'string') {
    throw new Error('invalid successful project document CAS response');
  }
  if (ownership) {
    if (result.ownershipEpoch !== ownership.epoch) {
      throw new Error('project ownership epoch changed during save');
    }
    advanceBrowserProjectOwnership(ownership, result.currentRevision);
  }
  await cacheMutation(key, result);
  await clearPendingKey(key);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await ready();
  if (isProjectDocumentKey(key)) {
    await setProjectDocument(key, value);
    return;
  }
  if (!remoteCache) {
    await localSet(key, value);
    if (!injectedBackend) await markPendingKey(key);
    return;
  }
  if (!projectStoreWriteCredential()) {
    throw new Error('The shared project store is read-only (no editor session connected), so changes were not synced');
  }
  try {
    await requestProjectStore({ operation: 'set', key, value });
  } catch (error) {
    if (isAuthError(error)) {
      throw new Error('The shared project store is read-only (the editor session expired), so changes were not synced');
    }
    await disableRemote();
    await localSet(key, value);
    await markPendingKey(key);
    return;
  }
  await localSet(key, value);
  await clearPendingKey(key);
  remoteKnown.add(key);
  remoteCache = { ...remoteCache, [key]: value };
}

export async function kvDel(key: string): Promise<void> {
  await ready();
  // Deleting a project document must always go through the shared store: a
  // silent local-only delete is what let deleted projects "resurrect" on
  // other ports (their server copy + other ports' caches stayed intact).
  // Node memory fallback (no IndexedDB) keeps local semantics for checks.
  const requireSharedDelete = isProjectDocumentKey(key) && (canSync() || hasIdb());
  if (!remoteCache) {
    if (requireSharedDelete) throw new Error('\u5171\u4eab\u5de5\u7a0b\u6570\u636e\u5e93\u6682\u65f6\u4e0d\u53ef\u7528，\u5de5\u7a0b\u672a\u5220\u9664');
    await localDel(key);
    return;
  }
  if (isProjectDocumentKey(key) && !projectStoreWriteCredential()) {
    throw new Error('\u5171\u4eab\u5de5\u7a0b\u5e93\u4e3a\u53ea\u8bfb\u6a21\u5f0f（\u672a\u8fde\u63a5\u7f16\u8f91\u5668\u4f1a\u8bdd），\u5de5\u7a0b\u672a\u5220\u9664');
  }
  try {
    await requestProjectStore({ operation: 'delete', key });
  } catch (error) {
    if (isAuthError(error) && isProjectDocumentKey(key)) {
      throw new Error('\u5171\u4eab\u5de5\u7a0b\u5e93\u53ea\u8bfb（\u7f16\u8f91\u5668\u4f1a\u8bdd\u5931\u6548），\u5de5\u7a0b\u672a\u5220\u9664');
    }
    await disableRemote();
    if (requireSharedDelete) throw error;
    await localDel(key);
    return;
  }
  await localDel(key);
  remoteKnown.add(key);
  remoteCache = Object.fromEntries(Object.entries(remoteCache).filter(([name]) => name !== key));
}

async function purgeLocalProjectEntries(projectId: string): Promise<void> {
  for (const key of await localKeys()) {
    if (projectIdFromProjectStoreKey(key) === projectId) await localDel(key);
  }
}

function forgetRemoteProjectEntries(projectId: string): void {
  remoteCache = Object.fromEntries(
    Object.entries(remoteCache ?? {}).filter(([key]) =>
      projectIdFromProjectStoreKey(key) !== projectId),
  );
  for (const key of remoteKnown) {
    if (projectIdFromProjectStoreKey(key) === projectId) remoteKnown.delete(key);
  }
}

export async function kvPurgeProject(projectId: string): Promise<void> {
  await ready();
  const requireSharedDelete = canSync();
  if (!remoteCache) {
    if (requireSharedDelete) throw new Error('\u5171\u4eab\u5de5\u7a0b\u6570\u636e\u5e93\u6682\u65f6\u4e0d\u53ef\u7528，\u5de5\u7a0b\u672a\u5220\u9664');
    await purgeLocalProjectEntries(projectId);
    return;
  }
  try {
    await requestProjectStore({ operation: 'purge-project', projectId });
  } catch (error) {
    await disableRemote();
    if (requireSharedDelete) throw error;
    await purgeLocalProjectEntries(projectId);
    return;
  }
  await purgeLocalProjectEntries(projectId);
  forgetRemoteProjectEntries(projectId);
}

/** Read/write/offline mode of the shared KV for UI hints. */
export function kvRemoteMode(): 'remote' | 'local' {
  return remoteCache ? 'remote' : 'local';
}

function isAuthError(error: unknown): error is Error & { status: number } {
  if (!(error instanceof Error)) return false;
  const status = Reflect.get(error, 'status');
  return typeof status === 'number' && status >= 400 && status < 500;
}

export async function kvKeys(): Promise<string[]> {
  await ready();
  if (remoteCache) {
    try {
      const snapshot = await requestSnapshot();
      const pending: Record<string, unknown> = {};
      for (const key of locallyPendingKeys) pending[key] = await localGet(key);
      remoteCache = { ...snapshot.entries, ...pending };
      remoteKnown.clear();
      for (const key of Object.keys(remoteCache)) remoteKnown.add(key);
      return Object.keys(remoteCache);
    } catch {
      await disableRemote();
    }
  }
  return (await localKeys()).filter((key) => key !== MIGRATION_KEY && key !== PENDING_KEYS_KEY);
}

/** Test helper: reset the Node fallback shared by all persistence modules. */
export function resetSharedKvMemory(): void {
  resetLocalKvMemory();
  remoteCache = null;
  remoteKnown.clear();
  locallyPendingKeys.clear();
  readyPromise = undefined;
  projectMigrationPending = false;
  resetProjectStoreTransport();
}
