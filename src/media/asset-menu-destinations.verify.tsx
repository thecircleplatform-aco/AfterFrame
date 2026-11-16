import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const testLocaleId = '\0asset-menu-destinations-test-locale';
const vite = await createServer({
  appType: 'custom',
  plugins: [{
    name: 'asset-menu-destinations-test-locale',
    enforce: 'pre',
    resolveId(id) {
      return id.endsWith('/i18n/locale') || id.endsWith('/i18n/locale.ts') ? testLocaleId : null;
    },
    load(id) {
      if (id !== testLocaleId) return null;
      return `
        export const t = (text, params) => params
          ? text.replace(/\\{(\\w+)\\}/g, (match, key) => key in params ? String(params[key]) : match)
          : text;
        export const useT = () => t;
      `;
    },
  }],
  server: { middlewareMode: true },
});

try {
  const { AssetMenuDestinations } = await vite.ssrLoadModule(
    '/src/media/AssetMenuDestinations.tsx',
  ) as typeof import('./AssetMenuDestinations');
  const { BlankMediaMenuActions } = await vite.ssrLoadModule(
    '/src/media/MediaPoolOverlays.tsx',
  ) as typeof import('./MediaPoolOverlays');
  const { runAssetDestinationAction } = await vite.ssrLoadModule(
    '/src/media/assetDestination.ts',
  ) as typeof import('./assetDestination');
  const { assetMenuSelectionIds, assetMenuFavoriteValue, batchAssetRename, duplicateAssetName } = await vite.ssrLoadModule(
    '/src/media/assetMenuSelection.ts',
  ) as typeof import('./assetMenuSelection');

  const calls: string[] = [];
  const actions = {
    timeline: () => calls.push('timeline'),
    chat: () => calls.push('chat'),
  };

  runAssetDestinationAction('timeline', actions);
  runAssetDestinationAction('chat', actions);
  assert.deepEqual(calls, ['timeline', 'chat']);
  assert.deepEqual(
    assetMenuSelectionIds('asset-b', new Set(['asset-a', 'asset-b']), ['asset-a', 'asset-b', 'asset-c']),
    ['asset-a', 'asset-b'],
    '\u53f3\u952e\u5df2\u9009\u7d20\u6750\u5fc5\u987b\u4fdd\u7559\u6574\u4e2a\u591a\u9009\u96c6',
  );
  assert.equal(duplicateAssetName('\u9879\u76ee\u7d20\u6750.mp4', 'copy'), '\u9879\u76ee\u7d20\u6750 copy.mp4');
  assert.equal(duplicateAssetName('\u65e0\u6269\u5c55\u540d', 'copy'), '\u65e0\u6269\u5c55\u540d copy');
  assert.deepEqual(
    assetMenuSelectionIds('asset-c', new Set(['asset-a', 'asset-b']), ['asset-a', 'asset-b', 'asset-c']),
    ['asset-c'],
    '\u53f3\u952e\u672a\u9009\u7d20\u6750\u5fc5\u987b\u53ea\u64cd\u4f5c\u5f53\u524d\u7d20\u6750',
  );
  assert.equal(
    assetMenuFavoriteValue([{ favorite: true }, { favorite: false }]),
    true,
    '\u6279\u91cf\u6536\u85cf\u53ea\u8981\u5176\u4e2d\u4e00\u4e2a\u672a\u6536\u85cf，\u5c31\u5e94\u7edf\u4e00\u6536\u85cf',
  );
  assert.equal(
    assetMenuFavoriteValue([{ favorite: true }, { favorite: true }]),
    false,
    '\u6279\u91cf\u53d6\u6d88\u6536\u85cf\u53ea\u5728\u5168\u90e8\u5df2\u6536\u85cf\u65f6\u53d1\u751f',
  );
  assert.deepEqual(
    batchAssetRename([
      { id: 'asset-a', name: '\u539f\u7247.mp4' },
      { id: 'asset-b', name: '\u5c01\u9762.png' },
    ], '\u9879\u76ee\u7d20\u6750'),
    [
      { id: 'asset-a', name: '\u9879\u76ee\u7d20\u6750.mp4' },
      { id: 'asset-b', name: '\u9879\u76ee\u7d20\u6750 2.png' },
    ],
    '\u6279\u91cf\u91cd\u547d\u540d\u5fc5\u987b\u4fdd\u7559\u5404\u7d20\u6750\u6269\u5c55\u540d，\u5e76\u7ed9\u540e\u7eed\u7d20\u6750\u6dfb\u52a0\u7a33\u5b9a\u5e8f\u53f7',
  );

  const markup = renderToStaticMarkup(createElement(AssetMenuDestinations, {
    assetName: '7\u67087\u65e5.mp4',
    onAddTimeline: () => undefined,
    onAddChat: () => undefined,
  }));

  assert.match(markup, /\u6dfb\u52a0\u5230：/);
  assert.match(markup, />\u65f6\u95f4\u7ebf</);
  assert.match(markup, />AI \u5bf9\u8bdd\u6846</);
  assert.ok(markup.indexOf('>AI \u5bf9\u8bdd\u6846<') < markup.indexOf('>\u65f6\u95f4\u7ebf<'), 'AI \u5bf9\u8bdd\u6846\u5e94\u4f4d\u4e8e\u5de6\u4fa7，\u65f6\u95f4\u7ebf\u5e94\u4f4d\u4e8e\u53f3\u4fa7');
  assert.match(markup, /aria-label="\u6dfb\u52a0 7\u67087\u65e5.mp4 \u5230\u65f6\u95f4\u7ebf"/);
  assert.match(markup, /aria-label="\u6dfb\u52a0 7\u67087\u65e5.mp4 \u5230 AI \u5bf9\u8bdd\u6846"/);

  const documentMarkup = renderToStaticMarkup(createElement(AssetMenuDestinations, {
    assetName: 'script.md',
    onAddChat: () => undefined,
  }));
  assert.match(documentMarkup, />AI \u5bf9\u8bdd\u6846</);
  assert.doesNotMatch(documentMarkup, />\u65f6\u95f4\u7ebf</);

  const blankMenuMarkup = renderToStaticMarkup(createElement(BlankMediaMenuActions, {
    clipboardCount: 2,
    visibleCount: 3,
    allVisibleSelected: false,
    view: 'grid',
    sort: 'newest',
    type: 'all',
    onPaste: () => undefined,
    onSelectAll: () => undefined,
    onUpload: () => undefined,
    onSemanticSearch: () => undefined,
    onMobileUpload: () => undefined,
    onCreateFolder: () => undefined,
    onViewToggle: () => undefined,
    onSort: () => undefined,
    onType: () => undefined,
  }));
  assert.match(blankMenuMarkup, /\u7c98\u8d34\u526f\u672c \(2\)/);
  assert.match(blankMenuMarkup, />\u5168\u9009</);
  assert.match(blankMenuMarkup, />\u4e0a\u4f20\u7d20\u6750</);
  assert.match(blankMenuMarkup, />\u672c\u5730\u8bed\u4e49\u641c\u7d22</);
  assert.match(blankMenuMarkup, />\u624b\u673a\u4f20\u7d20\u6750</);
  assert.match(blankMenuMarkup, />\u65b0\u5efa\u6587\u4ef6\u5939</);
  assert.match(blankMenuMarkup, /aria-label="\u7d20\u6750\u6392\u5e8f"/);
  assert.match(blankMenuMarkup, /aria-label="\u7b5b\u9009\u7d20\u6750"/);

  const overlaySource = await readFile(new URL('./MediaPoolOverlays.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(overlaySource, /className="cc-asset-menu-backdrop"/, '\u7d20\u6750\u83dc\u5355\u4e0d\u5e94\u4f7f\u7528\u5168\u5c4f\u906e\u7f69\u963b\u65ad\u76f4\u63a5\u53f3\u952e\u53e6\u4e00\u7d20\u6750');
  assert.match(overlaySource, /document\.addEventListener\('pointerdown', closeOutside, true\)/, '\u7d20\u6750\u83dc\u5355\u5e94\u901a\u8fc7\u5916\u90e8\u70b9\u51fb\u5173\u95ed');
} finally {
  await vite.close();
}

console.log('asset menu destinations verified');
