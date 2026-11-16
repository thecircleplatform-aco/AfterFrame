import assert from 'node:assert/strict';
import { SETTINGS_CATEGORIES } from './settingsSchema.ts';

const storageCategory = SETTINGS_CATEGORIES.find((category) => category.key === 'cloud');
const storageGroup = storageCategory?.groups.find((group) => group.key === 'storage');
assert.ok(storageGroup, 'storage settings group must exist');
assert.equal(storageGroup.title, '\u9ed8\u8ba4\u5de5\u7a0b\u4f4d\u7f6e');
assert.deepEqual(
  storageGroup.vendors.filter((vendor) => vendor.vendor === 'localdisk')
    .flatMap((vendor) => vendor.fields.map((field) => field.name)),
  ['AFTERFRAME_DATA_DIR'],
  'the UI must expose one default project location instead of separate media/import roots',
);
assert.equal(
  storageCategory?.groups.some((group) => group.key === 'local-files'),
  false,
  'Agent path allowlists are advanced configuration, not a second storage-location setting',
);

process.stdout.write('settingsStorage.verify: one default project location passed\n');
