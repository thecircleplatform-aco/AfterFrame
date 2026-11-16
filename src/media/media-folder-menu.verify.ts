// Runnable: `npx tsx src/media/media-folder-menu.verify.ts`
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const card = readFileSync(new URL('./MediaPoolCard.tsx', import.meta.url), 'utf8');
const overlays = readFileSync(new URL('./MediaPoolOverlays.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('./MediaPoolPanel.tsx', import.meta.url), 'utf8');
const menus = readFileSync(new URL('./MediaPoolMenus.tsx', import.meta.url), 'utf8');
const grid = readFileSync(new URL('./MediaPoolGrid.tsx', import.meta.url), 'utf8');

assert.match(card, /onContextMenu/, '\u6587\u4ef6\u5939\u5361\u7247\u5fc5\u987b\u54cd\u5e94\u53f3\u952e');
assert.match(card, /onOpenMenu/, '\u6587\u4ef6\u5939\u5361\u7247\u5fc5\u987b\u66b4\u9732\u83dc\u5355\u5165\u53e3');
assert.match(card, /cc-folder-more/, '\u6587\u4ef6\u5939\u5361\u7247\u5e94\u6709 ⋯ \u6309\u94ae');
assert.match(overlays, /export function FolderMenuPortal/, '\u5fc5\u987b\u6709\u6587\u4ef6\u5939\u83dc\u5355 portal');
assert.match(overlays, /\u53ea\u80fd\u5220\u9664\u7a7a\u6587\u4ef6\u5939/, '\u975e\u7a7a\u6587\u4ef6\u5939\u5220\u9664\u5e94\u7981\u7528\u5e76\u63d0\u793a');
assert.match(menus, /FolderMenuPortal/, 'domain-local media menus must mount the folder portal');
assert.match(panel, /MediaPoolMenus/, '\u7d20\u6750\u6c60\u9762\u677f\u5fc5\u987b\u6302\u8f7d\u63d0\u53d6\u540e\u7684\u6587\u4ef6\u5939\u83dc\u5355');
assert.match(panel, /onOpenFolderMenu/, '\u7f51\u683c\u5fc5\u987b\u63a5\u6536\u6587\u4ef6\u5939\u83dc\u5355\u56de\u8c03');
assert.match(grid, /onOpenFolderMenu/, '\u7f51\u683c\u5fc5\u987b\u628a\u6587\u4ef6\u5939\u83dc\u5355\u4f20\u7ed9\u5361\u7247');
assert.match(panel, /currentFolderId === state\.id/, '\u5220\u9664\u975e\u5f53\u524d\u6587\u4ef6\u5939\u65f6\u4e0d\u5f97\u8df3\u8f6c\u5bfc\u822a');

console.log('media-folder-menu.verify: ok (\u53f3\u952e/⋯/portal/\u7a7a\u6587\u4ef6\u5939\u5220\u9664/\u5bfc\u822a)');
