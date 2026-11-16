import assert from 'node:assert/strict';
import type { MediaAsset } from '../editor/types';
import { MediaImportCancelledError } from './mediaImportConflict';
import { importMediaBatch } from './mediaPoolImport';

const failedProbe = new Error('unsupported media type');
const starts: string[] = [];
const successful = { id: 'good', name: 'good.mov' } as MediaAsset;
const firstBatchErrors = await importMediaBatch({
  files: [{ name: 'bad.txt' } as File, { name: 'good.mov' } as File],
  targetFolderId: 'folder-a',
  onImport: async (file, _onProgress, lifecycle) => {
    starts.push(file.name);
    if (file.name === 'bad.txt') throw failedProbe;
    lifecycle?.onPlaceholder?.(successful);
    return successful;
  },
  onMoveAssets: () => undefined,
  onProgress: () => undefined,
});

assert.deepEqual(starts, ['bad.txt', 'good.mov'], '\u5355\u6587\u4ef6\u5728 placeholder \u524d\u5931\u8d25\u540e\u4ecd\u987b\u7ee7\u7eed\u5bfc\u5165\u540e\u7eed\u6587\u4ef6');
assert.deepEqual(firstBatchErrors, [failedProbe], '\u6279\u6b21\u7ed3\u675f\u540e\u53ea\u6c47\u603b\u5b9e\u9645\u5bfc\u5165\u5931\u8d25');

const conflictStarts: string[] = [];
const conflictPlacements: string[] = [];
const overwritten = { id: 'overwrite', name: 'same-name.mov' } as MediaAsset;
const conflictErrors = await importMediaBatch({
  files: [{ name: 'cancel.mov' } as File, { name: 'same-name.mov' } as File],
  targetFolderId: 'folder-b',
  onImport: async (file) => {
    conflictStarts.push(file.name);
    if (file.name === 'cancel.mov') throw new MediaImportCancelledError();
    return overwritten;
  },
  onMoveAssets: (ids, folderId) => conflictPlacements.push(`${ids[0]}:${folderId}`),
  onProgress: () => undefined,
});

assert.deepEqual(conflictStarts, ['cancel.mov', 'same-name.mov'], '\u65e0 placeholder \u7684\u53d6\u6d88\u4e0d\u80fd\u963b\u65ad\u540e\u7eed\u8986\u76d6\u5bfc\u5165');
assert.deepEqual(conflictErrors, [], '\u7528\u6237\u53d6\u6d88\u4e0d\u5e94\u663e\u793a\u4e3a\u6279\u6b21\u5931\u8d25');
assert.deepEqual(conflictPlacements, ['overwrite:folder-b'], '\u65e0 placeholder \u7684\u8986\u76d6\u7ed3\u679c\u4ecd\u987b\u8fdb\u5165\u76ee\u6807\u6587\u4ef6\u5939');

console.log('media-pool-progressive-import.verify: failures and conflict choices preserve batch progress');
