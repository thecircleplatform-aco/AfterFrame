import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesktopWindowControlButtons } from '../components/DesktopWindowControls';

const moduleUrl = new URL('./UpstreamUpdateNoticeView.tsx', import.meta.url);
const noticeModule = await import(moduleUrl.href).catch(() => null);

assert.ok(noticeModule, '\u5e94\u7528\u5e94\u63d0\u4f9b\u975e\u963b\u585e\u7684\u4e0a\u6e38\u7248\u672c\u63d0\u793a');

const { UpstreamUpdateNoticeView } = noticeModule;
const markup = renderToStaticMarkup(
  <div data-dashboard-chrome>
    <UpstreamUpdateNoticeView
      message="\u53d1\u73b0 AfterFrame \u65b0\u7248\u672c V0.2.0，\u5f53\u524d\u7248\u672c V0.1.9\u3002\u53ef\u4ee5\u76f4\u63a5\u4e0b\u8f7d\u5e76\u5b89\u88c5\u3002"
      actionLabel="\u4e0b\u8f7d\u66f4\u65b0"
      closeLabel="\u5173\u95ed"
      onAction={() => undefined}
      onDismiss={() => undefined}
    />
    <DesktopWindowControlButtons
      translate={(text) => text}
      onAction={() => undefined}
    />
  </div>,
);

assert.match(markup, /\u53d1\u73b0 AfterFrame \u65b0\u7248\u672c V0\.2\.0/, '\u65b0\u7248\u63d0\u793a\u5fc5\u987b\u660e\u786e\u7ed9\u51fa\u5b98\u65b9\u4ea7\u54c1\u4e0e\u7248\u672c');
assert.match(markup, />\u4e0b\u8f7d\u66f4\u65b0<\/button>/, '\u684c\u9762\u65b0\u7248\u63d0\u793a\u5fc5\u987b\u63d0\u4f9b\u76f4\u63a5\u4e0b\u8f7d\u52a8\u4f5c');
assert.match(markup, /role="status"/, '\u975e\u963b\u585e\u63d0\u793a\u5e94\u4f7f\u7528\u72b6\u6001\u8bed\u4e49');
assert.doesNotMatch(markup, /<a\b/, '\u66f4\u65b0\u5165\u53e3\u5fc5\u987b\u8d70\u53d7\u63a7\u684c\u9762 IPC \u800c\u4e0d\u662f\u4efb\u610f\u94fe\u63a5');
assert.match(markup, /top:50%/, '\u66f4\u65b0\u63d0\u793a\u5e94\u5728\u9996\u9875\u5782\u76f4\u5c45\u4e2d');
assert.match(markup, /left:50%/, '\u66f4\u65b0\u63d0\u793a\u5e94\u5728\u9996\u9875\u6c34\u5e73\u5c45\u4e2d');
assert.match(markup, /z-index:190/, '\u66f4\u65b0\u63d0\u793a\u5fc5\u987b\u4f4d\u4e8e\u8bbe\u7f6e\u5f39\u7a97\u4e0b\u65b9，\u907f\u514d\u906e\u6321\u8bbe\u7f6e\u64cd\u4f5c');
assert.match(markup, /transform:translate\(-50%,\s*-50%\)/, '\u66f4\u65b0\u63d0\u793a\u5e94\u4ee5\u81ea\u8eab\u4e2d\u5fc3\u5bf9\u51c6\u7a97\u53e3\u4e2d\u5fc3');
assert.match(markup, /aria-label="\u7a97\u53e3\u63a7\u5236"/, '\u684c\u9762\u7a97\u53e3\u63a7\u5236\u5fc5\u987b\u4e0e\u9996\u9875\u66f4\u65b0\u63d0\u793a\u5728\u540c\u4e00 dashboard chrome \u4e2d\u53ef\u6e32\u67d3');
assert.equal((markup.match(/class="cc-window-control /g) ?? []).length, 3, 'macOS \u6807\u9898\u680f\u5e94\u4fdd\u7559\u4e09\u4e2a\u7a97\u53e3\u63a7\u5236\u6309\u94ae');


console.log('upstream-update-notice.verify: dashboard-only centered upstream update notice OK');
