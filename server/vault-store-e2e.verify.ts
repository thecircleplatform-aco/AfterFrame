// End-to-end: relocate a real SQLite database into a vault-shaped folder and
// confirm the copy is a working database — not just bytes that happen to exist.
//
// The pure relocation test covers the filesystem rules. This one covers the
// thing that actually matters: SQLite must still open the copy and return the
// rows, including writes that were sitting in the WAL when the source closed.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { relocateDatabaseToVault } from './vault-store.ts';
import { VAULT_LAYOUT } from './vault.ts';

const fixture = await mkdtemp(join(tmpdir(), 'occ-vault-db-'));

try {
  const profileDir = join(fixture, 'profile');
  const vaultRoot = join(fixture, 'vault');
  await mkdir(profileDir, { recursive: true });
  await mkdir(vaultRoot, { recursive: true });

  const source = join(profileDir, 'project-store-v1.sqlite3');

  // Build a real database shaped like the project store, in WAL mode, with
  // committed data still living in the WAL (the normal state while running).
  {
    const db = new DatabaseSync(source);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);');
    const insert = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?)');
    insert.run('projects', JSON.stringify([{ id: 'p1', name: 'Demo' }]));
    insert.run('project:p1', JSON.stringify({ version: 3, assets: [] }));
    insert.run('chat:p1', JSON.stringify({ messages: [{ role: 'user', text: 'hello' }] }));
    // close() checkpoints the WAL, which is exactly what the route does before
    // relocating. If it did not, the copy below would be missing these rows.
    db.close();
  }

  const outcome = await relocateDatabaseToVault({
    from: source,
    to: join(vaultRoot, VAULT_LAYOUT.database),
  });
  assert.equal(outcome.kind, 'copied');

  // The copied database must open and contain every row.
  const copy = join(vaultRoot, VAULT_LAYOUT.database);
  const db = new DatabaseSync(copy, { readOnly: true });
  const rows = db.prepare('SELECT k FROM kv ORDER BY k').all() as { k: string }[];
  const chat = db.prepare('SELECT v FROM kv WHERE k = ?').get('chat:p1') as { v: string } | undefined;
  db.close();

  assert.deepEqual(
    rows.map((row) => row.k),
    ['chat:p1', 'project:p1', 'projects'],
    'the vault copy must contain every project AND the chat history',
  );
  assert.match(
    chat?.v ?? '',
    /hello/,
    'chat history must survive the move — that is the whole point of keeping it with the project',
  );

  // The source database must still be openable: a failed move stays recoverable.
  const original = new DatabaseSync(source, { readOnly: true });
  const count = original.prepare('SELECT COUNT(*) AS n FROM kv').get() as { n: number };
  original.close();
  assert.equal(count.n, 3, 'the original database must remain intact as a backup');

  // Re-running the migration must refuse rather than overwrite the vault copy.
  const again = await relocateDatabaseToVault({
    from: source,
    to: copy,
  });
  assert.equal(again.kind, 'destination-occupied', 'a second migration must not clobber the vault');

  // A vault database is only useful if it opens; prove a deliberately truncated
  // copy does NOT pass that bar, so the guard has a reason to exist.
  const broken = join(fixture, 'broken.sqlite3');
  await writeFile(broken, 'not a database');
  assert.throws(
    () => new DatabaseSync(broken, { readOnly: true }).prepare('SELECT 1 FROM kv').get(),
    'a truncated copy must fail to open, which is why the copy is verified before switching',
  );

  console.log('vault-store-e2e: the relocated database still opens and keeps chats + projects');
} finally {
  await rm(fixture, { recursive: true, force: true }).catch(() => undefined);
}
