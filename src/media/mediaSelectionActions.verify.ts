import assert from 'node:assert/strict';
import { addAssetsToChat, allVisibleAssetsSelected, toggleVisibleAssetSelection } from './mediaSelectionActions';

const visible = ['map', 'route', 'video'];

assert.equal(allVisibleAssetsSelected(new Set(['map', 'route', 'video', 'outside']), visible), true,
  '\u5f53\u524d\u53ef\u89c1\u7d20\u6750\u5168\u90e8\u5df2\u9009\u65f6，\u7a7a\u767d\u53f3\u952e\u83dc\u5355\u5e94\u6539\u4e3a\u53d6\u6d88\u5168\u9009');
assert.deepEqual(
  [...toggleVisibleAssetSelection(new Set(['map', 'route', 'video', 'outside']), visible)].sort(),
  ['outside'],
  '\u53d6\u6d88\u5168\u9009\u53ea\u80fd\u79fb\u9664\u5f53\u524d\u53ef\u89c1\u7d20\u6750，\u4e0d\u80fd\u8bef\u6e05\u9664\u5176\u4ed6\u6587\u4ef6\u5939\u6216\u7b5b\u9009\u5916\u7684\u9009\u62e9',
);
assert.deepEqual(
  [...toggleVisibleAssetSelection(new Set(['map', 'outside']), visible)].sort(),
  ['map', 'outside', 'route', 'video'],
  '\u672a\u5168\u9009\u65f6\u5e94\u8865\u9f50\u5f53\u524d\u53ef\u89c1\u7d20\u6750，\u540c\u65f6\u4fdd\u7559\u5df2\u6709\u7684\u5176\u4ed6\u9009\u62e9',
);

const selectedAssets = [{ id: 'map' }, { id: 'route' }, { id: 'video' }];
const chatCalls: Array<Array<{ id: string }>> = [];
addAssetsToChat(selectedAssets, (assets) => chatCalls.push(assets));
assert.equal(chatCalls.length, 1, '\u6279\u91cf\u6dfb\u52a0\u5230 AI \u5bf9\u8bdd\u6846\u5fc5\u987b\u53ea\u8c03\u7528\u4e00\u6b21 callback');
assert.deepEqual(chatCalls[0]?.map((asset) => asset.id), ['map', 'route', 'video'],
  '\u4e00\u6b21 chat seed \u5fc5\u987b\u4fdd\u6301\u5168\u90e8\u7d20\u6750\u5f15\u7528\u7684\u9009\u62e9\u987a\u5e8f');

console.log('media selection actions verification passed');
