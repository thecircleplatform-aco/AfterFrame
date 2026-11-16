import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlayerRef } from '@remotion/player';
import type { RefObject } from 'react';
import type { TimelineItem, TimelineState } from '../../editor/types';
import { t } from '../../i18n/locale';
import { PreviewTransformOverlay } from './PreviewTransformOverlay';
import { fitPreviewCanvasSize, previewPaddedClientSize, previewStageContentSize } from './previewCanvasGeometry';

const item: TimelineItem = {
  id: 'card',
  track: 'V2',
  startFrame: 0,
  durationInFrames: 90,
  kind: 'motion-graphic',
  name: '\u91d1\u53e5\u5361\u7247',
  width: 1080,
  height: 1920,
  transform: { x: 5, y: -4, scale: 0.8, rotation: 8 },
};

const stateOf = (trackPatch: Record<string, unknown> = {}, selectedId: string | null = 'card'): TimelineState => ({
  fps: 30,
  width: 1080,
  height: 1920,
  fit: 'contain',
  selectedId,
  selectedIds: selectedId ? [selectedId] : [],
  trackOrder: ['V2'],
  tracks: { V2: { kind: 'video', ...trackPatch } },
  items: [item],
});

const playerRef = {
  current: { getCurrentFrame: () => 20, pause: () => undefined } as unknown as PlayerRef,
} as RefObject<PlayerRef | null>;

const props = {
  playerRef,
  onSelectItem: () => undefined,
  onSetItemTransform: () => undefined,
  onSetItemKeyframe: () => undefined,
  onBeginHistoryGesture: () => undefined,
  onEndHistoryGesture: () => undefined,
};

// The canvas wrapper itself must be the contained composition rect. All
// interactive overlays are inset:0 children of this wrapper, so keeping its
// aspect is what makes caption hit boxes and clip handles share one coordinate
// space after an aspect switch.
assert.deepEqual(
  fitPreviewCanvasSize(
    { width: 558, height: 770 },
    { width: 1920, height: 1080 },
  ),
  { width: 558, height: 313.875 },
  '16:9 \u5e94\u5728\u7ad6\u5411\u8f83\u9ad8\u7684\u9884\u89c8\u680f\u4e2d\u6309\u5bbd\u5ea6 contain，\u4e14\u5bbd\u9ad8\u5171\u7528\u540c\u4e00 scale',
);
assert.deepEqual(
  fitPreviewCanvasSize(
    { width: 558, height: 770 },
    { width: 1080, height: 1080 },
  ),
  { width: 558, height: 558 },
  '1:1 \u5e94\u5f97\u5230\u6b63\u65b9\u5f62\u547d\u4e2d\u5c42\u4e0e\u7f16\u8f91\u6846',
);
assert.deepEqual(
  fitPreviewCanvasSize(
    { width: 900, height: 500 },
    { width: 1080, height: 1920 },
  ),
  { width: 281.25, height: 500 },
  '9:16 \u5e94\u5728\u6a2a\u5411\u8f83\u5bbd\u7684\u9884\u89c8\u680f\u4e2d\u6309\u9ad8\u5ea6 contain，\u4e0d\u80fd\u628a 281.25 \u6536\u6210 281',
);
{
  const fitted = fitPreviewCanvasSize({ width: 360, height: 776 }, { width: 1080, height: 1920 });
  assert.equal(fitted.width * 1920, fitted.height * 1080, 'preview wrapper aspect must equal the composition');
  assert.deepEqual(fitted, { width: 360, height: 640 });
}
assert.deepEqual(
  previewStageContentSize({
    contentBoxSize: [{ inlineSize: 360, blockSize: 776 }],
    contentRect: { width: 360, height: 776 },
  }),
  { width: 360, height: 776 },
  'stage size is the content box, not clientWidth with padding',
);
assert.deepEqual(
  previewPaddedClientSize(
    { width: 400, height: 800 },
    { left: 20, right: 20, top: 12, bottom: 12 },
  ),
  { width: 360, height: 776 },
  '12px 20px stage padding must not be treated as composition space',
);
const previewPanelSource = readFileSync(new URL('../PreviewPanel.tsx', import.meta.url), 'utf8');
assert.match(
  previewPanelSource,
  /fitPreviewCanvasSize\(stageSize,\s*\{\s*width:\s*state\.width,\s*height:\s*state\.height/s,
  '\u9884\u89c8\u9762\u677f\u5fc5\u987b\u628a contain \u540e\u7684\u540c\u4e00\u753b\u5e03\u5c3a\u5bf8\u4ea4\u7ed9\u64ad\u653e\u5668\u3001\u5b57\u5e55\u547d\u4e2d\u5c42\u548c\u7247\u6bb5\u53d8\u6362\u5c42',
);
assert.match(
  previewPanelSource,
  /previewStageContentSize/,
  'ResizeObserver must use the stage content box so padding is not composition space',
);
assert.match(
  previewPanelSource,
  /previewPaddedClientSize/,
  'first layout must subtract stage padding from clientWidth',
);

// A selected editable clip exposes one compact transform frame and nine handles.
{
  const markup = renderToStaticMarkup(<PreviewTransformOverlay state={stateOf()} {...props} />);
  assert.ok(markup.includes(`aria-label="${t('Preview canvas clip transform')}"`));
  assert.match(markup, /data-preview-selection="card"/);
  assert.equal((markup.match(/data-preview-handle="scale-[0-3]"/g) ?? []).length, 4, '\u56db\u4e2a\u89d2\u90fd\u5e94\u53ef\u7b49\u6bd4\u7f29\u653e');
  assert.equal((markup.match(/data-preview-handle="crop-[nsew]"/g) ?? []).length, 4, '\u56db\u8fb9\u4e2d\u70b9\u5e94\u53ef\u88c1\u5207\u906e\u76d6');
  assert.equal((markup.match(/data-preview-handle="rotate"/g) ?? []).length, 1, '\u9876\u90e8\u5e94\u6709\u4e00\u4e2a\u65cb\u8f6c\u624b\u67c4');
  assert.match(markup, /var\(--cc-accent\)/, '\u63a7\u5236\u6846\u989c\u8272\u8ddf\u968f\u5f53\u524d\u76ae\u80a4\u5f3a\u8c03\u8272');
}

// Locked and hidden tracks can never expose writable controls.
for (const trackPatch of [{ locked: true }, { hidden: true }]) {
  const markup = renderToStaticMarkup(<PreviewTransformOverlay state={stateOf(trackPatch)} {...props} />);
  assert.doesNotMatch(markup, /data-preview-selection=/);
  assert.doesNotMatch(markup, /data-preview-handle=/);
}

// A timeline selection outside the current frame must not leave a stale box.
{
  const state = stateOf();
  state.items = [{ ...item, startFrame: 30 }];
  const markup = renderToStaticMarkup(<PreviewTransformOverlay state={state} {...props} />);
  assert.doesNotMatch(markup, /data-preview-selection=/);
}

// Window resize can briefly report a zero-size composition; controls stay hidden until geometry is valid.
{
  const state = stateOf();
  state.width = 0;
  state.height = 0;
  const markup = renderToStaticMarkup(<PreviewTransformOverlay state={state} {...props} />);
  assert.doesNotMatch(markup, /data-preview-selection=/);
  assert.doesNotMatch(markup, /data-preview-handle=/);
}

console.log('preview-transform-overlay.verify: ok (\u8bed\u4e49/\u76ae\u80a4/\u56db\u89d2/\u56db\u8fb9\u88c1\u5207/\u65cb\u8f6c/\u9501\u5b9a\u9690\u85cf/\u5e27\u8303\u56f4)');
