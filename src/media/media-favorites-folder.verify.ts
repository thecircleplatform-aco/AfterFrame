import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('./MediaPoolPanel.tsx', import.meta.url), 'utf8');
const grid = readFileSync(new URL('./MediaPoolGrid.tsx', import.meta.url), 'utf8');
const card = readFileSync(new URL('./MediaPoolCard.tsx', import.meta.url), 'utf8');

assert.match(panel, /setFavoritesOnly\(true\)/, '\u6536\u85cf\u5939\u5165\u53e3\u5fc5\u987b\u8fdb\u5165\u6536\u85cf\u89c6\u56fe');
assert.match(panel, /favoritesOnly \? ` \/ \$\{t\('\u6536\u85cf\u5939'\)\}`/, '\u6536\u85cf\u5939\u89c6\u56fe\u5fc5\u987b\u663e\u793a\u53ef\u8fd4\u56de\u7684\u9762\u5305\u5c51');
assert.match(grid, /kind: 'favorites'/, '\u865a\u62df\u7d20\u6750\u7f51\u683c\u5fc5\u987b\u5305\u542b\u6536\u85cf\u5939\u5165\u53e3\u7c7b\u578b');
assert.match(grid, /cc-folder-card cc-favorites-folder/, '\u6536\u85cf\u5939\u5fc5\u987b\u590d\u7528\u6587\u4ef6\u5939\u5361\u7247\u89c6\u89c9');
assert.match(card, /className="cc-asset-favorite"/, '\u6bcf\u5f20\u7d20\u6750\u5361\u5fc5\u987b\u63d0\u4f9b\u6536\u85cf\u6309\u94ae');
assert.match(card, /aria-pressed=\{!!asset\.favorite\}/, '\u6536\u85cf\u6309\u94ae\u5fc5\u987b\u516c\u5f00\u5f53\u524d\u72b6\u6001');
assert.match(card, /onSetFavorite\(asset\.id, !asset\.favorite\)/, '\u6536\u85cf\u6309\u94ae\u5fc5\u987b\u5207\u6362\u7d20\u6750 favorite \u5b57\u6bb5');
assert.doesNotMatch(card, /cc-asset-check/, '\u6536\u85cf\u661f\u6807\u5e94\u66ff\u4ee3\u5197\u4f59\u9009\u62e9\u52fe\u9009\u6846');

console.log('media-favorites-folder.verify: folder and card favorite controls are wired');
