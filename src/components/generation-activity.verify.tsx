import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EN } from '../i18n/dict/en';

const component = await readFile(new URL('./GenerationActivity.tsx', import.meta.url), 'utf8');
const topBarButton = await readFile(new URL('./TopBarIconButton.tsx', import.meta.url), 'utf8');

assert.match(
  component,
  /<TopBarIconButton[\s\S]*?icon="sparkles"[\s\S]*?label=\{t\('\u751f\u6210\u4efb\u52a1'\)\}/,
  '\u751f\u6210\u4efb\u52a1\u6309\u94ae\u5e94\u590d\u7528\u9876\u90e8\u680f\u56fe\u6807\u6309\u94ae',
);
assert.doesNotMatch(
  component,
  /title=\{t\('\u751f\u6210\u4efb\u52a1'\)\}/,
  '\u751f\u6210\u4efb\u52a1\u6309\u94ae\u4e0d\u5e94\u4f7f\u7528\u6837\u5f0f\u4e0d\u53ef\u63a7\u7684\u539f\u751f title',
);
assert.match(topBarButton, /className="cc-tip cc-tip-r"/, '\u5171\u4eab\u6309\u94ae\u5e94\u4f7f\u7528\u5373\u65f6 tooltip');
assert.match(topBarButton, /data-tip=\{label\}/, '\u5171\u4eab\u6309\u94ae\u5e94\u5c06\u672c\u5730\u5316\u6807\u7b7e\u7528\u4e8e tooltip');
assert.match(topBarButton, /onMouseEnter=/, '\u5171\u4eab\u6309\u94ae\u5e94\u63d0\u4f9b\u7edf\u4e00\u7684 hover \u53cd\u9988');
assert.match(topBarButton, /onMouseLeave=/, '\u5171\u4eab\u6309\u94ae\u5e94\u5728\u79bb\u5f00 hover \u540e\u6062\u590d\u6837\u5f0f');
assert.equal(component.match(/retryClassLabel\(job\.retryClass, t\)/g)?.length, 1, '\u6bcf\u4e2a\u4efb\u52a1\u5e94\u53ea\u8ba1\u7b97\u4e00\u6b21\u91cd\u8bd5\u6807\u7b7e');

const generationActivityKeys = [
  '\u751f\u6210\u4efb\u52a1',
  '\u65e7\u7248\u53c2\u6570\u6458\u8981（\u4e0d\u53ef\u5b89\u5168\u91cd\u8dd1）',
  '\u53c2\u6570\u5feb\u7167\u4e0d\u53ef\u7528',
  '\u5237\u65b0\u540e\u4ecd\u53ef\u7ee7\u7eed\u68c0\u67e5\u3001\u4e0b\u8f7d\u6216\u91cd\u8dd1',
  '\u6062\u590d\u4e2d…',
  '\u7ee7\u7eed\u4efb\u52a1',
  '\u6b63\u5728\u8bfb\u53d6\u4efb\u52a1…',
  '\u6682\u65e0\u751f\u6210\u4efb\u52a1',
  'Provider \u4efb\u52a1',
  '\u6253\u5f00\u7ed3\u679c',
  '\u91cd\u8bd5\u53ef\u6062\u590d\u4efb\u52a1',
  '\u68c0\u67e5\u8fdb\u5ea6',
  '\u7b49\u5f85\u4e2d',
  '\u8fdb\u884c\u4e2d',
  '\u5df2\u5b8c\u6210',
  '\u5931\u8d25',
  '\u672a\u627e\u5230',
  '\u53ef\u91cd\u8bd5\u4e0b\u8f7d',
  '\u53ef\u91cd\u8bd5\u751f\u6210',
  '\u91cd\u542f\u540e\u53ef\u6062\u590d',
  '\u4e0d\u53ef\u91cd\u8bd5',
  '\u65e7\u4efb\u52a1\u72b6\u6001\u672a\u77e5',
] as const;

for (const key of generationActivityKeys) {
  assert.notEqual(EN[key], undefined, `\u82f1\u6587\u8bcd\u5178\u5e94\u5305\u542b“${key}”`);
}

assert.match(component, /t\('\{n\} \u5206\u949f\u524d'/, '\u76f8\u5bf9\u5206\u949f\u6570\u5e94\u901a\u8fc7 i18n \u683c\u5f0f\u5316');
assert.match(component, /t\('\{n\} \u5c0f\u65f6\u524d'/, '\u76f8\u5bf9\u5c0f\u65f6\u6570\u5e94\u901a\u8fc7 i18n \u683c\u5f0f\u5316');
assert.match(component, /t\('\{n\} \u5929\u524d'/, '\u76f8\u5bf9\u5929\u6570\u5e94\u901a\u8fc7 i18n \u683c\u5f0f\u5316');

console.log('generation activity hover and localization verified');
