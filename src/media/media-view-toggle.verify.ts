import assert from 'node:assert/strict';
import englishMedia from '../i18n/dict/en/media';
import { mediaViewToggleLabel, toggleMediaView } from './mediaView';

assert.equal(mediaViewToggleLabel('list'), '\u5207\u6362\u5230\u7f51\u683c\u89c6\u56fe');
assert.equal(toggleMediaView('list'), 'grid');
assert.equal(mediaViewToggleLabel('grid'), '\u5207\u6362\u5230\u5217\u8868\u89c6\u56fe');
assert.equal(toggleMediaView('grid'), 'list');
for (const view of ['grid', 'list'] as const) {
  const label = mediaViewToggleLabel(view);
  assert.ok(englishMedia[label], `English media dictionary must contain the view-toggle label: ${label}`);
}

console.log('media view toggle verification passed');
