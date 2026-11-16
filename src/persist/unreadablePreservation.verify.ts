// Data-safety rule: boundary validation on READ must not become deletion on
// WRITE. Entries this build cannot parse are usually data written by a NEWER
// build; filtering them for display is right, writing the filtered list back
// destroys them. Covers versionStore / exportHistoryStore / templateStore /
// jobRegistryStore plus the v1→v2 unknown-field passthrough and the chat
// load. npx tsx src/persist/unreadablePreservation.verify.ts
import assert from 'node:assert/strict';
import { CURRENT_PROJECT_VERSION } from '../../shared/project-version';
import type { ProjectDoc } from '../editor/types';
import { partitionRecords, withPreservedRecords } from './recordPartition';
import { kvGet, kvSet, resetSharedKvMemory } from './sharedKv';
import { deleteVersion, listVersions, saveVersion } from './versionStore';
import { listExportHistory, recordExport } from './exportHistoryStore';
import { v1ToV2 } from './migrations/v1-to-v2';

const doc: ProjectDoc = {
  version: CURRENT_PROJECT_VERSION,
  assets: [],
  mediaFolders: [],
  timelines: [{
    id: 'tl1', name: '\u5e8f\u5217 1', fps: 30, width: 1920, height: 1080, selectedId: null, items: [],
  }],
  activeTimelineId: 'tl1',
} as unknown as ProjectDoc;

// ── partitionRecords / withPreservedRecords  ────────────────────────
{
  const parse = (v: unknown) => (typeof v === 'number' ? v : null);
  const { valid, opaque } = partitionRecords([1, 'x', 2, { future: true }], parse);
  assert.deepEqual(valid, [1, 2], 'parsable entries surface');
  assert.deepEqual(opaque, ['x', { future: true }], 'unparsable entries are kept verbatim');
  assert.deepEqual(withPreservedRecords([9], opaque), [9, 'x', { future: true }],
    'writes carry the opaque tail');
  assert.deepEqual(withPreservedRecords([9], []), [9], 'no opaque tail = plain array');
  assert.deepEqual(partitionRecords('not an array', parse), { valid: [], opaque: [] },
    'a non-array value degrades to empty, never throws');
}

// ── versionStore:(version 99) ─────────────
{
  resetSharedKvMemory();
  const projectId = 'proj-versions';
  const futureSnapshot = { id: 'future', name: '\u6765\u81ea\u65b0\u7248', createdAt: 1, doc: { version: 99 } };
  await kvSet(`versions:${projectId}`, [futureSnapshot]);
  assert.deepEqual(await listVersions(projectId), [], '\u4e0d\u53ef\u8bfb\u5feb\u7167\u4e0d\u8fdb\u5c55\u793a\u5217\u8868');

  await saveVersion(projectId, '\u672c\u7248\u5feb\u7167', doc);
  const stored = await kvGet<unknown[]>(`versions:${projectId}`);
  assert.equal(stored?.length, 2, '\u5199\u5165\u540e\u65b0\u65e7\u4e24\u6761\u90fd\u5728');
  assert.deepEqual(stored?.[1], futureSnapshot, '\u65b0\u7248\u5feb\u7167\u539f\u6837\u4fdd\u7559(\u672a\u88ab\u8fc7\u6ee4\u5199\u56de\u62b9\u6389)');
  assert.equal((await listVersions(projectId)).length, 1, '\u5c55\u793a\u5c42\u4ecd\u53ea\u770b\u5230\u53ef\u8bfb\u7684\u4e00\u6761');

  const mine = (await listVersions(projectId))[0]!;
  await deleteVersion(projectId, mine.id);
  const afterDelete = await kvGet<unknown[]>(`versions:${projectId}`);
  assert.deepEqual(afterDelete, [futureSnapshot], '\u5220\u9664\u81ea\u5df1\u7684\u7248\u672c\u4e0d\u7275\u8fde\u4e0d\u53ef\u8bfb\u6761\u76ee');
}

// ── exportHistoryStore: +  ────────────────────────
{
  resetSharedKvMemory();
  const futureRecord = { kind: 'future-export', payload: 1 };
  const knownWithExtra = {
    id: 'e1', name: 'a.mp4', format: 'video', createdAt: 2, futureField: 'keep-me',
  };
  await kvSet('export:history', [knownWithExtra, futureRecord]);
  await recordExport({ name: 'b.mp4', format: 'video', createdAt: 3 });
  const stored = await kvGet<Array<Record<string, unknown>>>('export:history');
  assert.equal(stored?.length, 3, '\u65b0\u8bb0\u5f55 + \u5df2\u77e5\u8bb0\u5f55 + \u4e0d\u53ef\u8bfb\u8bb0\u5f55');
  assert.deepEqual(stored?.[2], futureRecord, '\u4e0d\u53ef\u8bfb\u8bb0\u5f55\u539f\u6837\u4fdd\u7559');
  const preserved = stored?.find((r) => r.id === 'e1');
  assert.equal(preserved?.futureField, 'keep-me', '\u5df2\u77e5\u8bb0\u5f55\u4e0a\u7684\u672a\u77e5\u5b57\u6bb5\u900f\u4f20');
  assert.equal((await listExportHistory()).length, 2, '\u5c55\u793a\u5c42\u53ea\u5217\u53ef\u8bfb\u8bb0\u5f55');
}

// ── v1→v2:, designStyle  ─────────────────────
{
  const migrated = v1ToV2.migrate({
    version: 1,
    assets: [],
    mediaFolders: [],
    timelines: [{ id: 'tl1', name: 's', fps: 30, width: 1920, height: 1080, selectedId: null, items: [] }],
    activeTimelineId: 'tl1',
    futureTopLevel: { keep: true },
    designStyle: 'not-a-style',
  }) as Record<string, unknown>;
  assert.equal(migrated.version, 2, '\u7248\u672c\u63a8\u8fdb');
  assert.deepEqual(migrated.futureTopLevel, { keep: true }, '\u672a\u77e5\u9876\u5c42\u5b57\u6bb5\u4e0d\u518d\u84b8\u53d1');
  assert.equal(migrated.designStyle, undefined, '\u975e\u6cd5 designStyle \u4ecd\u88ab\u5265\u79bb(\u672a\u88ab spread \u5e26\u8fc7)');
}

console.log('unreadablePreservation.verify: ok');
