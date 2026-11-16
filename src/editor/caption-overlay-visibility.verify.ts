// :npx tsx src/editor/caption-overlay-visibility.verify.ts
// (CC ) captionsHidden
// :,/MG
// , MG , CC
// —— MG ,
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { captionOverlayVisible } from './timelineTypes';
import type { TimelineState } from './timelineTypes';

const base = (over: Partial<TimelineState> = {}): TimelineState => ({
  id: 'tl', name: 't', fps: 30, width: 1920, height: 1080, items: [], tracks: {}, ...over,
} as TimelineState);

const mg = { id: 'i1', track: 'V2', kind: 'motion-graphic', startFrame: 0, durationInFrames: 30, name: 'badge' } as TimelineState['items'][number];
const captionTrack = (enabled: boolean) => ({
  C1: {
    kind: 'caption',
    captions: { enabled, template: 'bubble-pop', pacing: 'phrase', sources: [], sourceMode: 'item', bilingual: false },
  },
} as unknown as TimelineState['tracks']);

// ──  ────────────────────────────────────────────────────────
assert.equal(captionOverlayVisible(base({ captionsHidden: true, items: [mg] })), false, '\u663e\u5f0f\u9690\u85cf');
assert.equal(captionOverlayVisible(base({ captionsHidden: false, tracks: captionTrack(false) })), true, '\u663e\u5f0f\u663e\u793a');

// ── : +  MG →  ───────────────────────────────
assert.equal(
  captionOverlayVisible(base({ tracks: captionTrack(false), items: [mg] })),
  true,
  '\u5173\u6389\u5b57\u5e55\u8f68\u4e0d\u80fd\u8fde\u5e26\u9690\u85cf MG(\u672c\u6587\u4ef6\u9876\u90e8\u63cf\u8ff0\u7684\u7ebf\u4e0a\u6545\u969c)',
);

// ──  ───────────────────────────────────────────────────────────
assert.equal(captionOverlayVisible(base({ tracks: captionTrack(true) })), true, '\u6709\u542f\u7528\u7684\u5b57\u5e55\u8f68');
assert.equal(captionOverlayVisible(base({ tracks: captionTrack(false) })), false, '\u65e2\u65e0\u5b57\u5e55\u4e5f\u65e0\u6587\u5b57/MG \u7247\u6bb5');

// ──  helper, ───────────────────────────
for (const file of ['./TimelineComposition.tsx', '../components/timeline/useTimelineController.ts']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source, /captionOverlayVisible\(state\)/, `${file} \u5fc5\u987b\u8c03\u7528\u5171\u4eab helper`);
  assert.doesNotMatch(
    source,
    /captionsHidden === undefined &&/,
    `${file} \u4e0d\u80fd\u518d\u5185\u8054\u81ea\u5df1\u7684 captionsHidden \u56de\u9000\u89c4\u5219`,
  );
}

console.log('caption-overlay-visibility.verify: ok (\u663e\u5f0f\u5f00\u5173/\u5173\u8f68\u4e0d\u9690\u85cf MG/\u9ed8\u8ba4\u5206\u652f/\u4e24\u7aef\u5171\u7528 helper)');
