import assert from 'node:assert/strict';
import type { MediaAsset } from '../editor/types';
import { importMediaBatch } from './mediaPoolImport';

const targetFolderId = 'folder-travel';
const placeholder = { id: 'asset-1', name: 'trip.mov' } as MediaAsset;
const ready = { ...placeholder, src: '/media/trip.mov' } as MediaAsset;
const placements: Array<{ ids: string[]; folderId?: string }> = [];

const errors = await importMediaBatch({
  files: [{ name: 'trip.mov' } as File],
  targetFolderId,
  onImport: async (_file, _onProgress, lifecycle) => {
    lifecycle?.onPlaceholder?.(placeholder);
    assert.deepEqual(placements.at(-1), { ids: ['asset-1'], folderId: targetFolderId },
      'placeholder \u5fc5\u987b\u7acb\u5373\u5f52\u5165\u62d6\u653e\u76ee\u6807\u6587\u4ef6\u5939');
    lifecycle?.onAssetUpdated?.(ready);
    assert.deepEqual(placements.at(-1), { ids: ['asset-1'], folderId: targetFolderId },
      'ready \u7d20\u6750\u5fc5\u987b\u518d\u6b21\u786e\u8ba4\u62d6\u653e\u76ee\u6807\u6587\u4ef6\u5939');
    return ready;
  },
  onMoveAssets: (ids, folderId) => placements.push({ ids, folderId }),
  onProgress: () => undefined,
});

assert.deepEqual(errors, [], '\u6210\u529f\u5bfc\u5165\u4e0d\u5e94\u4ea7\u751f\u6279\u6b21\u9519\u8bef');
assert.deepEqual(placements, [
  { ids: ['asset-1'], folderId: targetFolderId },
  { ids: ['asset-1'], folderId: targetFolderId },
], 'placeholder \u4e0e ready \u4e24\u4e2a\u9636\u6bb5\u5fc5\u987b\u5f52\u5165\u540c\u4e00\u4e2a\u62d6\u653e\u76ee\u6807\u6587\u4ef6\u5939');

const nestedPlacements: Array<{ ids: string[]; folderId?: string }> = [];
await importMediaBatch({
  files: [{ name: 'day-1.mov' } as File, { name: 'day-2.mov' } as File],
  targetFolderIds: ['folder-day-1', 'folder-day-2'],
  onImport: async (file) => ({ id: file.name, name: file.name }) as MediaAsset,
  onMoveAssets: (ids, folderId) => nestedPlacements.push({ ids, folderId }),
  onProgress: () => undefined,
});
assert.deepEqual(nestedPlacements, [
  { ids: ['day-1.mov'], folderId: 'folder-day-1' },
  { ids: ['day-2.mov'], folderId: 'folder-day-2' },
], '\u6bcf\u4e2a\u7d20\u6750\u5fc5\u987b\u4fdd\u7559\u5bfc\u5165\u76ee\u5f55\u4e2d\u7684\u6587\u4ef6\u5939\u5c42\u7ea7');

console.log('media-folder-drop.verify: placeholder and ready preserve the target folder');
