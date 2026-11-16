import { existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let attempted = false;

/**
 * One-time move of the pre-rebrand home directory.
 *
 * Before the rename this product kept its projects, keystore, dev profiles and
 * the MCP token under `~/.openchatcut`. Every path now resolves under
 * `~/.afterframe`, so without this the rebrand would look like total data loss
 * on an existing install. Runs at most once per process, only when the new home
 * is absent, so it can never overwrite live data.
 */
export function migrateLegacyHome(): void {
  if (attempted) return;
  attempted = true;
  try {
    const home = homedir();
    const legacy = join(home, '.openchatcut');
    const current = join(home, '.afterframe');
    if (!existsSync(legacy) || existsSync(current)) return;
    renameSync(legacy, current);
    console.warn('[afterframe] migrated legacy data directory to ~/.afterframe');
  } catch (error) {
    console.warn(
      `[afterframe] legacy home migration skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
