import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const toolbar = await readFile(new URL('./MediaPoolToolbar.tsx', import.meta.url), 'utf8');
const semantic = await readFile(new URL('./semantic-search/SemanticSearchControls.tsx', import.meta.url), 'utf8');

for (const label of ['\u4e0a\u4f20\u7d20\u6750', '\u6392\u5e8f', '\u7b5b\u9009', '\u66f4\u591a\u64cd\u4f5c']) {
  assert.match(toolbar, new RegExp(`data-tip=\\{t\\('${label}'\\)\\}`), `\u5a92\u4f53\u5de5\u5177\u680f\u5e94\u5373\u65f6\u63d0\u793a“${label}”`);
}
assert.match(toolbar, /data-tip=\{t\(mediaViewToggleLabel\(props\.view\)\)\}/, '\u7f51\u683c/\u5217\u8868\u5207\u6362\u5e94\u5373\u65f6\u63d0\u793a\u5f53\u524d\u64cd\u4f5c');
assert.match(semantic, /data-tip=\{t\('\u672c\u5730\u8bed\u4e49\u641c\u7d22'\)\}/, '\u672c\u5730\u8bed\u4e49\u641c\u7d22\u5e94\u4f7f\u7528\u5373\u65f6\u63d0\u793a');
assert.doesNotMatch(toolbar, /className=\{?`?[^\n]*cc-media-icon[^\n]*\stitle=/, '\u5a92\u4f53\u5de5\u5177\u680f\u56fe\u6807\u4e0d\u5e94\u4f9d\u8d56\u5ef6\u8fdf\u51fa\u73b0\u7684\u539f\u751f title');
assert.doesNotMatch(semantic, /className=\{?`?[^\n]*cc-media-icon[^\n]*\stitle=/, '\u8bed\u4e49\u641c\u7d22\u56fe\u6807\u4e0d\u5e94\u4f9d\u8d56\u5ef6\u8fdf\u51fa\u73b0\u7684\u539f\u751f title');

console.log('media toolbar immediate tooltips verified');
