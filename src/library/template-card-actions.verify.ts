import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./TemplateCard.tsx', import.meta.url), 'utf8');

assert.match(source, /onContextMenu=\{\(event\) =>/);
assert.match(source, /aria-label=\{t\('\u6dfb\u52a0\u5230\u65f6\u95f4\u7ebf：\{name\}'/);
assert.match(source, /<Icon name="plus"/);
assert.doesNotMatch(source, /className="cc-template-add"\s+onClick=/);
assert.match(source, /title=\{t\('\u66f4\u591a\u64cd\u4f5c'\)\}/, 'the visible menu button should remain keyboard accessible');

console.log('template-card-actions.verify: template cards separate drag, add, and management actions');
