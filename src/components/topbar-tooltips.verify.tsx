import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const exportHistory = await readFile(new URL('./ExportHistory.tsx', import.meta.url), 'utf8');

assert.match(
  exportHistory,
  /<TopBarIconButton[\s\S]*?icon="download"[\s\S]*?label=\{t\('\u5bfc\u51fa\u5386\u53f2'\)\}/,
  '\u5bfc\u51fa\u5386\u53f2\u6309\u94ae\u5e94\u590d\u7528\u9876\u90e8\u680f\u56fe\u6807\u6309\u94ae',
);
assert.doesNotMatch(
  exportHistory,
  /<button title=\{t\('\u5bfc\u51fa\u5386\u53f2'\)\}/,
  '\u5bfc\u51fa\u5386\u53f2\u6309\u94ae\u4e0d\u5e94\u4f7f\u7528\u6837\u5f0f\u4e0d\u53ef\u63a7\u7684\u539f\u751f title',
);

console.log('top bar immediate tooltips verified');
