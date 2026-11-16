/**
 * Recovery for a failed Vite dynamic-import preload (`vite:preloadError`).
 *
 * Ported verbatim from FreeCut (`freecut/src/app/vite-preload-recovery.ts`).
 *
 * A lazy chunk can fail to load for two reasons: a redeploy removed the old
 * chunk hash, or the network blipped. Both leave the route dead, and both are
 * fixed by a reload — but a blind reload throws away the user's unsaved edit.
 * So the ONLY safe order is save -> reload, and if the save fails we do not
 * navigate at all. Losing one route is recoverable; losing the project is not.
 */

interface RecoverDevVitePreloadOptions {
  save: () => Promise<boolean>;
  reload: () => void;
  onSaveFailure: () => void | Promise<void>;
}

/** Save before navigating so stale-module recovery never discards editor changes. */
export async function recoverDevVitePreload({
  save,
  reload,
  onSaveFailure,
}: RecoverDevVitePreloadOptions): Promise<boolean> {
  if (!(await save())) {
    await onSaveFailure();
    return false;
  }

  reload();
  return true;
}
