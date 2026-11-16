import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

const moduleUrl = new URL('./SettingsVersionControl.tsx', import.meta.url);
const versionModule = await import(moduleUrl.href).catch(() => null);

assert.ok(versionModule, '\u8bbe\u7f6e\u6807\u9898\u680f\u5e94\u63d0\u4f9b\u72ec\u7acb\u7684\u7248\u672c\u4e0e\u68c0\u67e5\u66f4\u65b0\u63a7\u4ef6');

const { SettingsVersionControl } = versionModule;
let requested = false;
const markup = renderToStaticMarkup(
  <SettingsVersionControl
    versionLabel="\u5f53\u524d\u7248\u672c\u53f7：V0.1.9"
    actionLabel="\u4e0b\u8f7d\u66f4\u65b0"
    disabled={false}
    onAction={() => { requested = true; }}
  />,
);

assert.match(markup, /\u5f53\u524d\u7248\u672c\u53f7：V0\.1\.9/, '\u8bbe\u7f6e\u6807\u9898\u680f\u5fc5\u987b\u5c55\u793a package.json \u5bf9\u5e94\u7248\u672c');
assert.match(markup, />\u4e0b\u8f7d\u66f4\u65b0<\/button>/, '\u684c\u9762\u7248\u53d1\u73b0\u65b0\u7248\u540e\u5fc5\u987b\u63d0\u4f9b\u76f4\u63a5\u4e0b\u8f7d\u5165\u53e3');
assert.doesNotMatch(markup, /\u81ea\u52a8\u66f4\u65b0/, '\u4e0b\u8f7d\u5fc5\u987b\u4fdd\u7559\u7528\u6237\u786e\u8ba4，\u4e0d\u5f97\u53d8\u6210\u9759\u9ed8\u81ea\u52a8\u66f4\u65b0');

const element = SettingsVersionControl({
  versionLabel: '\u5f53\u524d\u7248\u672c\u53f7：V0.1.9',
  actionLabel: '\u4e0b\u8f7d\u66f4\u65b0',
  disabled: false,
  onAction: () => { requested = true; },
});
const button = element.props.children[1];
button.props.onClick();
assert.equal(requested, true, '\u70b9\u51fb\u4e0b\u8f7d\u66f4\u65b0\u5fc5\u987b\u89e6\u53d1\u53d7\u63a7\u66f4\u65b0\u52a8\u4f5c');

console.log('settings-version.verify: current version and manual check control OK');
