// Runnable check: `npx tsx src/export/fcpxml.verify.ts`.
// Verify FCPXML export: structure and escape, track→lane, MG placeholder/baked reference, and two P0 fixes —
// ① Audio transcript editing must be split into multiple asset-clips that are consistent with the playback layer (keptSegments) segment by segment;
// ② The assets are converted to the absolute file:// path under mediaDir, otherwise the NLE is full of offline assets.
// Issue #27 blocks: every export validates against the FCPXML 1.10 DTD (fcpxml.verify-support.ts), src is an
// RFC 3986 file URL, in-place references (desktop folder/watched/agent imports) name the user's real file, and
// media with an embedded start timecode exports on that clock (asset start = timecode, clip start = timecode + in).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssetSrc, timelineToFcpxml } from './fcpxml';
import { fcpxmlDtdViolations } from './fcpxml.verify-support';
import { exportMediaSources, fcpxmlMediaLocations } from './exportMediaSources';
import { motionGraphicRenderKey } from './motionGraphicRefs';
import { keptSegments } from '../transcript/edit';
import type { TimelineItem, TimelineState } from '../editor/types';
import { EXPORT_MEDIA_SOURCES_ROUTE, type ExportMediaStart } from '../../shared/export-media-sources';
import { resolveExportMediaSources } from '../../server/export-media-sources';
import { registerMediaReference } from '../../server/media-references';

const clipsOf = (xml: string): string[] => xml.match(/<asset-clip[^>]*\/>/g) ?? [];
const attr = (el: string, name: string): string => el.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
const mediaRepSrc = (xml: string, kind: 'original-media' | 'proxy-media'): string | undefined => (
  xml.match(new RegExp(`<media-rep kind="${kind}" src="([^"]*)"`))?.[1]
);

// Exact FCPXML times ("N/Ds") as bigint fractions.
type Q = readonly [bigint, bigint];
const q = (time: string): Q => {
  const [num = '0', den = '1'] = time.replace(/s$/, '').split('/');
  return [BigInt(num), BigInt(den)];
};
const qOf = (value: number): Q => (Number.isInteger(value) ? [BigInt(value), 1n] : [BigInt(Math.round(value * 1000)), 1000n]);
const plus = (a: Q, b: Q): Q => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
const minus = (a: Q, b: Q): Q => [a[0] * b[1] - b[0] * a[1], a[1] * b[1]];
const times = (a: Q, b: Q): Q => [a[0] * b[0], a[1] * b[1]];
const over = (a: Q, b: Q): Q => [a[0] * b[1], a[1] * b[0]];
const sameQ = (a: Q, b: Q): boolean => a[0] * b[1] === b[0] * a[1];
const showQ = ([num, den]: Q): string => `${num}/${den}`;

/**
 * The source frame, counted from the file's own start, that clip `name` shows
 * `frame` frames after its first: its `start` is in the clip's (retimed) clock,
 * its <timeMap> takes that clock to media time (FCPXML: timept `time` is the
 * adjusted clip time, `value` the original), and the asset `start` is where the
 * file's frames begin. This is how Final Cut, Resolve and the #106 importer read it.
 */
function sourceFrameAt(xml: string, name: string, frame: number, fps: number): Q {
  const open = xml.match(new RegExp(`<asset-clip [^>]*name="${name}"[^>]*>`));
  const clip = !open ? '' : open[0].endsWith('/>')
    ? open[0]
    : xml.slice(open.index, xml.indexOf('</asset-clip>', open.index) + '</asset-clip>'.length);
  const assetStart = xml.match(new RegExp(`<asset id="${attr(clip, 'ref')}"[^>]*start="([^"]*)"`))?.[1] ?? '';
  assert.ok(clip && assetStart, `clip ${name} and its asset are in the export`);
  const rate = qOf(fps);
  const at = plus(q(attr(clip, 'start')), over(qOf(frame), rate));
  const points = [...clip.matchAll(/<timept time="([^"]*)" value="([^"]*)"/g)].map(([, time, value]) => [q(time!), q(value!)] as const);
  const [first, last] = [points[0], points.at(-1)];
  const media = first && last && points.length > 1
    ? plus(first[1], times(minus(at, first[0]), over(minus(last[1], first[1]), minus(last[0], first[0]))))
    : at;
  return times(minus(media, q(assetStart)), rate);
}

// ── Infrastructure: single root, required nodes, XML escaping, no undefined/NaN leaks ──
{
  const state: TimelineState = {
    fps: 30, width: 1920, height: 1080, selectedId: null,
    items: [
      { id: 'mg-1', track: 'V1', startFrame: 0, durationInFrames: 60, name: 'Title \u0001\uD800& <Intro>', kind: 'motion-graphic' },
      { id: 'mg-2', track: 'V1', startFrame: 60, durationInFrames: 90, name: 'Outro Card', kind: 'motion-graphic' },
      { id: 'vo-1', track: 'A1', startFrame: 0, durationInFrames: 150, name: 'Voiceover', kind: 'audio', src: '/media/uploads/vo.mp3' },
    ],
  };
  const xml = timelineToFcpxml(state, { title: 'Check\u0000\uFFFE Project' });
  assert.ok(xml.trim().startsWith('<?xml'), 'XML \u58f0\u660e\u5f00\u5934');
  assert.ok(xml.trim().endsWith('</fcpxml>'), 'fcpxml \u6536\u5c3e');
  assert.equal((xml.match(/<fcpxml /g) ?? []).length, 1, '\u5355\u6839\u5143\u7d20');
  for (const tag of ['<resources>', '<library>', '<sequence', '<spine>']) {
    assert.ok(xml.includes(tag), `\u7f3a\u5c11 ${tag}`);
  }
  assert.ok(xml.includes('frameDuration="1/30s"'), 'fps 30 → frameDuration 1/30s');
  assert.ok(xml.includes('Title &amp; &lt;Intro&gt;'), '\u540d\u5b57\u8981\u8f6c\u4e49');
  assert.ok(!xml.includes('Title & <Intro>'), '\u672a\u8f6c\u4e49\u539f\u6587\u4e0d\u5f97\u6cc4\u6f0f');
  assert.ok(!/undefined|NaN/.test(xml), '\u8f93\u51fa\u4e0d\u5f97\u542b undefined/NaN');
  const invalidXmlChar = [...xml].find((char) => {
    const codePoint = char.codePointAt(0)!;
    return !(codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff));
  });
  assert.equal(invalidXmlChar, undefined,
    'FCPXML sink emits only XML 1.0-legal characters in attributes and comments');
  // MG no media → placeholder gap;audio → asset-clip
  assert.equal(clipsOf(xml).length, 1, '\u4ec5\u97f3\u9891\u51fa asset-clip');
  assert.equal((xml.match(/<gap name="MG:/g) ?? []).length, 2, '\u4e24\u4e2a MG \u5360\u4f4d gap');
  // Track → lane: video positive, audio negative
  assert.equal(attr(clipsOf(xml)[0]!, 'lane'), '-1', '\u97f3\u9891\u6302\u8d1f lane');
  // A gap is a clip_item, not an anchor_item, and has no lane attribute: the
  // placeholder rides in a connected storyline timed from its own start.
  const placeholders = [...xml.matchAll(
    /<spine lane="([^"]*)" offset="([^"]*)" name="MG: [^"]*"><gap name="MG: [^"]*" offset="0s" duration="([^"]*)">/g,
  )].map((match) => match.slice(1));
  assert.deepEqual(placeholders, [['1', '0/30s', '60/30s'], ['1', '60/30s', '90/30s']],
    'MG placeholders keep their lane, timeline position and length');
  assert.deepEqual(fcpxmlDtdViolations(xml), [], 'MG placeholders validate against the FCPXML 1.10 DTD');

  const rendered = state.items[0]!;
  const renderedXml = timelineToFcpxml({ ...state, items: [rendered, state.items[2]!] }, {
    motionGraphicRenderKeys: [motionGraphicRenderKey(rendered)],
  });
  assert.ok(renderedXml.includes('src="file:./mg-'), 'fixture exercises the rendered-MG asset path');
  assert.deepEqual(fcpxmlDtdViolations(renderedXml), [], 'rendered MG references validate against the DTD');
}

// ── P0-①: Audio transcript editing → multiple paragraphs, aligned with keptSegments one by one ──
{
  // hello 0–1s | ummmm 1–3s(delete) | world 3–4s, timestamp is milliseconds
  const transcript = [
    { text: 'hello', start: 0, end: 1000 },
    { text: 'ummmm', start: 1000, end: 3000 },
    { text: 'world', start: 3000, end: 4000 },
  ];
  const segs = keptSegments(transcript, new Set([1]), 30, 0, {});
  const edited = segs.reduce((sum, seg) => sum + seg.durFrames, 0);
  const state: TimelineState = {
    fps: 30, width: 1920, height: 1080, selectedId: null,
    tracks: { A1: { kind: 'audio' } }, trackOrder: ['A1'],
    items: [{
      id: 'vo', track: 'A1', startFrame: 0, durationInFrames: edited, kind: 'audio',
      name: '\u914d\u97f3', src: '/media/uploads/vo.wav', transcript, deletedWordIdx: [1],
    }],
  };
  const clips = clipsOf(timelineToFcpxml(state));
  assert.equal(clips.length, segs.length, `\u5bfc\u51fa\u6bb5\u6570\u987b\u7b49\u4e8e\u64ad\u653e\u6bb5\u6570(${segs.length})`);
  segs.forEach((seg, i) => {
    assert.equal(attr(clips[i]!, 'offset'), `${seg.fromFrame}/30s`, `\u7b2c ${i + 1} \u6bb5\u65f6\u95f4\u7ebf\u4f4d\u7f6e`);
    assert.equal(attr(clips[i]!, 'duration'), `${seg.durFrames}/30s`, `\u7b2c ${i + 1} \u6bb5\u65f6\u957f`);
    assert.equal(attr(clips[i]!, 'start'), `${seg.srcStartFrame}/30s`, `\u7b2c ${i + 1} \u6bb5\u6e90\u5165\u70b9`);
  });
  // Regression red line: deleted words must not be overwritten by a paragraph (source frames 30–90)
  const covers = clips.some((c) => {
    const s = Number(attr(c, 'start').split('/')[0]);
    const d = Number(attr(c, 'duration').split('/')[0]);
    return s < 90 && s + d > 30;
  });
  assert.ok(!covers, '\u5220\u6389\u7684\u53e3\u7656\u4e0d\u5f97\u51fa\u73b0\u5728\u4efb\u4f55\u4e00\u6bb5\u91cc');
  // The asset duration should cover the farthest source frame actually used (duration after editing 60 < used 120)
  const assetDur = timelineToFcpxml(state).match(/<asset [^>]*duration="([^"]*)"/)?.[1];
  assert.equal(assetDur, '120/30s', 'asset \u65f6\u957f\u6309\u771f\u5b9e\u7528\u5230\u7684\u6e90\u533a\u95f4');
}

// ── The deletion of words in the video file does not change the picture → it is still a single segment (same semantics as the rendering layer) ──
{
  const state: TimelineState = {
    fps: 30, width: 1920, height: 1080, selectedId: null,
    tracks: { V1: { kind: 'video' } }, trackOrder: ['V1'],
    items: [{
      id: 'cam', track: 'V1', startFrame: 0, durationInFrames: 60, kind: 'video',
      name: '\u673a\u4f4d', src: '/media/uploads/cam.mp4',
      transcript: [{ text: 'a', start: 0, end: 1000 }, { text: 'b', start: 1000, end: 2000 }],
      deletedWordIdx: [0],
    }],
  };
  assert.equal(clipsOf(timelineToFcpxml(state)).length, 1, 'video \u4ef6\u4fdd\u6301\u5355\u6bb5\u8fde\u7eed\u64ad\u653e');
}

// ── Retime: <timeMap> and the clip start share one clock, so the first and last frames sample the right source ──
{
  const cases = [
    { fps: 25, inFrame: 50, duration: 20, rate: 2 },
    { fps: 25, inFrame: 9, duration: 20, rate: 1.5 },
    { fps: 30, inFrame: 10, duration: 40, rate: 0.5 },
    { fps: 29.97, inFrame: 45, duration: 30, rate: 2 },
    { fps: 25, inFrame: 12.5, duration: 10, rate: 2.5 },
    { fps: 25, inFrame: 0, duration: 20, rate: 2 },
  ];
  for (const { fps, inFrame, duration, rate } of cases) {
    const xml = timelineToFcpxml({
      fps, width: 1920, height: 1080, selectedId: null, tracks: { V1: { kind: 'video' } }, trackOrder: ['V1'],
      items: [{
        id: 'fast', track: 'V1', startFrame: 30, durationInFrames: duration, kind: 'video', name: 'fast',
        src: '/media/uploads/fast.mp4', srcInFrame: inFrame, playbackRate: rate,
      }],
    }, { mediaDir: '/m' });
    const label = `${rate}x from source frame ${inFrame} at ${fps} fps`;
    assert.ok(sameQ(sourceFrameAt(xml, 'fast', 0, fps), qOf(inFrame)),
      `${label}: the first frame samples the in-point, not speed × in-point (got ${showQ(sourceFrameAt(xml, 'fast', 0, fps))})`);
    assert.ok(sameQ(sourceFrameAt(xml, 'fast', duration - 1, fps), qOf(inFrame + (duration - 1) * rate)),
      `${label}: the last frame samples in-point + (duration - 1) × speed`);
    assert.match(xml, /<timept time="0s" value="0s" interp="linear"\/>/, `${label}: the map starts at the media's origin`);
    assert.doesNotMatch(xml, /="\d+\.\d+\/\d+s"/, `${label}: every time is an integer fraction`);
    assert.deepEqual(fcpxmlDtdViolations(xml), [], `${label}: validates against the FCPXML 1.10 DTD`);
  }
  const fromZero = timelineToFcpxml({
    fps: 30, width: 1920, height: 1080, selectedId: null,
    items: [{ id: 'z', track: 'V1', startFrame: 0, durationInFrames: 90, kind: 'video', name: 'z', src: '/m.mp4', playbackRate: 2 }],
  });
  assert.match(fromZero, /start="0\/30s"[\s\S]*<timept time="0s" value="0s"[^>]*\/>\s*<timept time="90\/30s" value="180\/30s"/,
    'a clip from the first frame keeps its previous output');
  const fractional = timelineToFcpxml({
    fps: 25, width: 1920, height: 1080, selectedId: null,
    items: [{ id: 'h', track: 'V1', startFrame: 0, durationInFrames: 10, kind: 'video', name: 'h', src: '/m.mp4', srcInFrame: 12.5 }],
  });
  assert.equal(attr(clipsOf(fractional)[0]!, 'start'), '12500/25000s', 'a fractional in-point is still an integer fraction');
}

// ── P0-②: Convert the asset path to absolute file:// ──
{
  assert.equal(
    resolveAssetSrc('/media/uploads/a.mp4', '/Users/me/proj/public/media/uploads'),
    'file:///Users/me/proj/public/media/uploads/a.mp4',
    'POSIX \u7edd\u5bf9\u8def\u5f84',
  );
  assert.equal(
    resolveAssetSrc('/media/uploads/%E9%87%87%E8%AE%BF.mp4', '/Users/me/\u5a92\u4f53'),
    'file:///Users/me/%E5%AA%92%E4%BD%93/%E9%87%87%E8%AE%BF.mp4',
    '\u4e2d\u6587\u76ee\u5f55\u4e0e\u6587\u4ef6\u540d\u9010\u6bb5\u7f16\u7801',
  );
  assert.equal(
    resolveAssetSrc('/media/uploads/b roll.mov', '/Users/me/clips/'),
    'file:///Users/me/clips/b%20roll.mov',
    '\u7a7a\u683c\u7f16\u7801 + \u76ee\u5f55\u5c3e\u659c\u6760\u5f52\u4e00',
  );
  assert.equal(
    resolveAssetSrc('/media/uploads/a.mp4', 'D:\\Media\\Uploads'),
    'file:///D:/Media/Uploads/a.mp4',
    'Windows \u76d8\u7b26\u8def\u5f84(\u5192\u53f7\u4fdd\u6301\u539f\u6837)',
  );
  assert.equal(
    resolveAssetSrc('\\\\server\\\u5171\u4eab \u7a7a\u95f4\\\u65c5\u884c.\u6700\u7ec8\u7248.001.MOV'),
    'file://server/%E5%85%B1%E4%BA%AB%20%E7%A9%BA%E9%97%B4/%E6%97%85%E8%A1%8C.%E6%9C%80%E7%BB%88%E7%89%88.001.MOV',
    'Windows UNC \u8def\u5f84\u4fdd\u7559\u4e3b\u673a\u5e76\u9010\u6bb5\u7f16\u7801',
  );
  assert.equal(
    resolveAssetSrc('https://cdn.example.com/a.mp4', '/Users/me/clips'),
    'https://cdn.example.com/a.mp4',
    '\u8fdc\u7a0b\u5730\u5740\u539f\u6837\u900f\u4f20,\u4e0d\u8c0e\u62a5\u672c\u5730\u8def\u5f84',
  );
  assert.equal(
    resolveAssetSrc('/media/uploads/a.mp4'),
    'file:///media/uploads/a.mp4',
    '\u65e0 mediaDir \u65f6\u9000\u56de\u539f\u8def\u5f84(\u5bfc\u51fa\u4ecd\u53ef\u51fa,\u7d20\u6750\u79bb\u7ebf)',
  );

  const state: TimelineState = {
    fps: 30, width: 1920, height: 1080, selectedId: null,
    tracks: { A1: { kind: 'audio' } }, trackOrder: ['A1'],
    items: [{ id: 'a', track: 'A1', startFrame: 0, durationInFrames: 30, kind: 'audio', name: '\u97f3', src: '/media/uploads/\u91c7\u8bbf.wav' }],
  };
  const xml = timelineToFcpxml(state, { mediaDir: '/Users/me/clips' });
  assert.ok(xml.includes('src="file:///Users/me/clips/'), '\u5bfc\u51fa\u4e32\u5230 asset \u7684 src \u4e0a');
  assert.ok(xml.includes('name="\u91c7\u8bbf.wav"'), 'asset \u540d\u5b57\u7528\u53ef\u8bfb\u7684\u89e3\u7801\u540e\u6587\u4ef6\u540d');
  const assetOpen = xml.match(/<asset(?=[\s>])[^>]*>/)?.[0] ?? '';
  assert.ok(!/\ssrc=/.test(assetOpen), 'FCPXML 1.10 asset \u4e0d\u518d\u4f7f\u7528\u65e7\u7248 src \u5c5e\u6027');
  assert.ok(xml.includes('<media-rep kind="original-media"'), '\u65e7\u5de5\u7a0b\u4ee5\u5185\u90e8\u5206\u7247\u4f5c\u4e3a original-media \u56de\u9000');
}

// ── Issue #27: preserve immutable original-media identity beside the internal working copy ──
{
  const internalSrc = '/media/uploads/8e45fd6f-8da8-4d6a-8a4f-339d6a8fd747.mp4';
  const sourceFilename = '\u65c5\u884c.\u6700\u7ec8\u7248.001.MOV';
  const originalFilePath = '/Users/me/\u65c5\u884c/\u65c5\u884c.\u6700\u7ec8\u7248.001.MOV';
  const item = {
    id: 'clip-1', track: 'V1', startFrame: 0, durationInFrames: 30, kind: 'video' as const,
    name: '\u7528\u6237\u6539\u8fc7\u7684\u663e\u793a\u540d', src: internalSrc, sourceFilename, originalFilePath,
  };
  const state: TimelineState = {
    fps: 30, width: 1920, height: 1080, selectedId: null,
    tracks: { V1: { kind: 'video' } }, trackOrder: ['V1'],
    items: [item],
    assets: [{
      id: 'asset-1', name: '\u53e6\u4e00\u4e2a\u663e\u793a\u540d', kind: 'video', src: internalSrc,
      durationInFrames: 30, sourceFilename, originalFilePath,
    }],
  };
  const xml = timelineToFcpxml(state, { mediaDir: '/Users/me/.afterframe/media' });
  const assetOpen = xml.match(/<asset(?=[\s>])[^>]*>/)?.[0] ?? '';
  assert.ok(!/\ssrc=/.test(assetOpen), 'asset \u5730\u5740\u53ea\u80fd\u5b58\u5728\u4e8e media-rep');
  assert.ok(assetOpen.includes('name="\u65c5\u884c.\u6700\u7ec8\u7248.001.MOV"'), '\u53ef\u7f16\u8f91\u663e\u793a\u540d\u4e0d\u5f97\u8986\u76d6\u539f\u59cb\u6587\u4ef6\u540d');
  assert.ok(xml.includes('kind="original-media" src="file:///Users/me/%E6%97%85%E8%A1%8C/%E6%97%85%E8%A1%8C.%E6%9C%80%E7%BB%88%E7%89%88.001.MOV"'));
  assert.ok(xml.includes('kind="proxy-media" src="file:///Users/me/.afterframe/media/8e45fd6f-8da8-4d6a-8a4f-339d6a8fd747.mp4"'));
  // FCPXML 1.9+ declares <!ELEMENT media-rep (bookmark?)> with src #REQUIRED.
  // <pathurl> is FCP7 xmeml: Final Cut Pro rejects the whole import on it.
  assert.ok(!xml.includes('<pathurl'), 'no FCP7 <pathurl> inside FCPXML media-rep');
  assert.equal((xml.match(/<media-rep [^>]*\/>/g) ?? []).length, 2, 'media-rep carries its location only in src');
  assert.deepEqual(fcpxmlDtdViolations(xml), [], 'original/proxy export validates against the FCPXML 1.10 DTD');
  assert.equal(
    fileURLToPath(mediaRepSrc(xml, 'original-media')!),
    originalFilePath,
    'percent-encoded Chinese src decodes back to the exact original path',
  );
  assert.equal((xml.match(/suggestedFilename="\u65c5\u884c\.\u6700\u7ec8\u7248\.001"/g) ?? []).length, 2, '\u539f\u7247\u4e0e\u4ee3\u7406\u5efa\u8bae\u6587\u4ef6\u540d\u5171\u7528\u53bb\u9664\u6700\u7ec8\u6269\u5c55\u540d\u7684\u539f\u59cb stem');

  const encodedSeparatorXml = timelineToFcpxml({
    ...state,
    assets: [{
      ...state.assets![0]!,
      sourceFilename: 'literal%2F\u65c5\u884c.\u6700\u7ec8\u7248.001.MOV',
    }],
  }, { mediaDir: '/Users/me/.afterframe/media' });
  assert.ok(encodedSeparatorXml.includes('suggestedFilename="literal%2F\u65c5\u884c.\u6700\u7ec8\u7248.001"'),
    'literal percent-encoded separators in sourceFilename are not URL-decoded by the serializer');
  assert.ok(!encodedSeparatorXml.includes('suggestedFilename="\u65c5\u884c.\u6700\u7ec8\u7248.001"'));

  const withoutPool = timelineToFcpxml({ ...state, assets: undefined }, { mediaDir: '/Users/me/.afterframe/media' });
  assert.ok(withoutPool.includes('kind="original-media" src="file:///Users/me/%E6%97%85%E8%A1%8C/'), '\u79fb\u9664\u6c60\u7d20\u6750\u540e\u56de\u9000\u65f6\u95f4\u7ebf\u6765\u6e90\u5143\u6570\u636e');

  const windowsXml = timelineToFcpxml({
    ...state,
    assets: [{ ...state.assets![0]!, originalFilePath: 'D:\\\u5a92\u4f53\\\u65c5\u884c.\u6700\u7ec8\u7248.001.MOV' }],
  }, { mediaDir: 'D:\\AfterFrame\\media' });
  assert.ok(windowsXml.includes('src="file:///D:/%E5%AA%92%E4%BD%93/%E6%97%85%E8%A1%8C.%E6%9C%80%E7%BB%88%E7%89%88.001.MOV"'), 'Windows \u539f\u7247\u8def\u5f84\u5408\u6cd5\u7f16\u7801');

  const uncXml = timelineToFcpxml({
    ...state,
    assets: [{ ...state.assets![0]!, originalFilePath: '\\\\server\\\u5171\u4eab \u7a7a\u95f4\\\u65c5\u884c.\u6700\u7ec8\u7248.001.MOV' }],
  }, { mediaDir: '\\\\server\\AfterFrame\\media' });
  assert.ok(uncXml.includes('kind="original-media" src="file://server/%E5%85%B1%E4%BA%AB%20%E7%A9%BA%E9%97%B4/%E6%97%85%E8%A1%8C.%E6%9C%80%E7%BB%88%E7%89%88.001.MOV"'), 'UNC \u539f\u7247\u8def\u5f84\u5408\u6cd5\u7f16\u7801');
  assert.ok(uncXml.includes('kind="proxy-media" src="file://server/AfterFrame/media/8e45fd6f-8da8-4d6a-8a4f-339d6a8fd747.mp4"'), 'UNC \u4ee3\u7406\u8def\u5f84\u5408\u6cd5\u7f16\u7801');
}

// ── Issue #27: src is an RFC 3986 file URL (what Final Cut Pro writes) that decodes to the exact disk path ──
{
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['ASCII', '/Users/me/clips/A001_C002.mov', 'file:///Users/me/clips/A001_C002.mov'],
    ['spaces', '/Users/me/my clips/b roll.mov', 'file:///Users/me/my%20clips/b%20roll.mov'],
    ['Chinese', '/Users/me/\u7d20\u6750/\u91c7\u8bbf 01.mp4', 'file:///Users/me/%E7%B4%A0%E6%9D%90/%E9%87%87%E8%AE%BF%2001.mp4'],
    ['#', '/Users/me/take #1.mov', 'file:///Users/me/take%20%231.mov'],
    ['%', '/Users/me/100% crop.mov', 'file:///Users/me/100%25%20crop.mov'],
  ];
  for (const [label, originalFilePath, expected] of cases) {
    const state: TimelineState = {
      fps: 30, width: 1920, height: 1080, selectedId: null,
      tracks: { V1: { kind: 'video' } }, trackOrder: ['V1'],
      items: [{
        id: 'clip', track: 'V1', startFrame: 0, durationInFrames: 30, kind: 'video', name: label,
        src: '/media/uploads/0b0c5d4e.mp4', originalFilePath,
      }],
    };
    const xml = timelineToFcpxml(state, { mediaDir: '/Users/me/.afterframe/media' });
    const src = mediaRepSrc(xml, 'original-media');
    assert.equal(src, expected, `${label}: UTF-8 percent-encoded per path segment`);
    assert.equal(fileURLToPath(src!), originalFilePath, `${label}: src decodes back to the exact on-disk path`);
    assert.doesNotMatch(src!, /[^\x21-\x7e]/, `${label}: no raw space or non-ASCII byte reaches src`);
    assert.ok(!xml.includes('<pathurl'), `${label}: no <pathurl> element`);
    assert.deepEqual(fcpxmlDtdViolations(xml), [], `${label}: validates against the FCPXML 1.10 DTD`);
  }

  // Retimed clips (<timeMap>) and background-fill metadata stay DTD-valid too.
  const retimed = timelineToFcpxml({
    fps: 30, width: 1080, height: 1920, selectedId: null,
    tracks: { V1: { kind: 'video' } }, trackOrder: ['V1'],
    items: [{
      id: 'fast', track: 'V1', startFrame: 0, durationInFrames: 60, kind: 'video', name: 'fast',
      src: '/media/uploads/fast.mp4', playbackRate: 2, width: 1920, height: 1080,
      backgroundFill: true, backgroundFillStrength: 40,
    }],
  }, { mediaDir: '/m', nleFormat: 'fcp_xml_resolve' });
  assert.ok(retimed.includes('<timeMap>') && retimed.includes('com.afterframe.backgroundFill'),
    'fixture exercises the retime and background-fill paths');
  assert.deepEqual(fcpxmlDtdViolations(retimed), [], 'retime + background fill export validates against the DTD');
}

// ── Issue #27: in-place references export the user's file, never the nonexistent <mediaDir>/<storedName> ──
{
  const root = await mkdtemp(join(tmpdir(), 'occ-fcpxml-references-'));
  try {
    const uploads = join(root, 'media');
    const folder = join(root, '\u7d20\u6750 #1');
    await Promise.all([mkdir(uploads, { recursive: true }), mkdir(folder, { recursive: true })]);
    const [camera, key, tone, moved, dropped] = ['\u91c7\u8bbf 100%.MOV', 'key #2.mov', 'room tone.wav', 'moved away.mov', 'web.mp4']
      .map((name) => join(folder, name));
    await Promise.all([camera, key, tone, moved, dropped].map((file) => writeFile(file, 'media')));
    const stem = '8e45fd6f-8da8-4d6a-8a4f-339d6a8fd747';
    // What folder/watched/agent imports leave behind (server/local-media-import.ts): a
    // reference manifest, plus the working copy the timeline plays for video.
    await registerMediaReference(uploads, `${stem}.mov`, camera);
    await writeFile(join(uploads, `${stem}.normalized.mp4`), 'compatibility transcode');
    await registerMediaReference(uploads, 'a1b2.mov', key);
    await writeFile(join(uploads, 'a1b2.alpha.webm'), 'transparent proxy');
    await registerMediaReference(uploads, 'c3d4.wav', tone);
    await registerMediaReference(uploads, 'e5f6.mov', moved);
    const movedCanonical = await realpath(moved);
    await rm(moved);
    await writeFile(join(uploads, 'managed.mp4'), 'browser upload copy');
    const clip = (id: string, track: string, src: string, kind: 'video' | 'audio', extra: Partial<TimelineItem> = {}) => ({
      id, track, src, kind, startFrame: 0, durationInFrames: 30, name: id, ...extra,
    });
    const state: TimelineState = {
      fps: 30, width: 1920, height: 1080, selectedId: null,
      tracks: { V1: { kind: 'video' }, V2: { kind: 'video' }, V3: { kind: 'video' }, V4: { kind: 'video' }, A1: { kind: 'audio' } },
      trackOrder: ['V4', 'V3', 'V2', 'V1', 'A1'],
      items: [
        clip('cam', 'V1', `/media/uploads/${stem}.normalized.mp4`, 'video', { sourceFilename: '\u91c7\u8bbf 100%.MOV' }),
        clip('key', 'V2', '/media/uploads/a1b2.alpha.webm', 'video'),
        clip('gone', 'V3', '/media/uploads/e5f6.mov', 'video'),
        // Drag/drop keeps a renderer path too; a stale one must not beat the server's lookup.
        clip('web', 'V4', '/media/uploads/managed.mp4', 'video', { originalFilePath: dropped }),
        clip('tone', 'A1', '/media/uploads/c3d4.wav', 'audio', { originalFilePath: join(root, 'stale', 'tone.wav') }),
      ],
    };
    const mediaSources = await resolveExportMediaSources(state.items.map((item) => item.src!), async () => null, [uploads]);
    const xml = timelineToFcpxml(state, { mediaDir: uploads, mediaSources });
    const asset = (id: string): string => xml.match(new RegExp(`<asset id="id-${id}"[\\s\\S]*?</asset>`))?.[0] ?? '';
    const pathOf = (id: string, kind: 'original-media' | 'proxy-media'): string | undefined => {
      const src = mediaRepSrc(asset(id), kind);
      return src === undefined ? undefined : fileURLToPath(src);
    };
    assert.equal(pathOf('cam', 'original-media'), await realpath(camera), 'directory-imported video links its camera original');
    assert.equal(pathOf('cam', 'proxy-media'), join(uploads, `${stem}.normalized.mp4`), 'the played transcode stays the proxy');
    assert.equal(pathOf('key', 'original-media'), await realpath(key), 'alpha proxy resolves to its MOV original');
    assert.equal(pathOf('key', 'proxy-media'), join(uploads, 'a1b2.alpha.webm'));
    assert.equal(pathOf('tone', 'original-media'), await realpath(tone), 'server lookup beats a stale renderer path');
    assert.equal(pathOf('tone', 'proxy-media'), undefined, 'a reference played in place has no separate proxy');
    assert.equal(pathOf('gone', 'original-media'), movedCanonical, 'an offline reference still names where the original was');
    assert.equal(pathOf('web', 'original-media'), dropped, 'managed copies keep the drag/drop original');
    assert.equal(pathOf('web', 'proxy-media'), join(uploads, 'managed.mp4'));
    for (const name of [`${stem}.mov`, 'a1b2.mov', 'c3d4.wav', 'e5f6.mov']) {
      assert.ok(!xml.includes(`src="${resolveAssetSrc(`/media/uploads/${name}`, uploads)}"`),
        `${name} is only a manifest: its <mediaDir> path must never be exported`);
    }
    for (const [, src] of xml.matchAll(/src="(file:\/\/[^"]*)"/g)) {
      const path = fileURLToPath(src!);
      assert.ok(path === movedCanonical || existsSync(path), `NLE can open ${path}`);
    }
    assert.deepEqual(fcpxmlDtdViolations(xml), [], 'reference export validates against the FCPXML 1.10 DTD');

    // Without the server lookup (preview build) the export still goes out on the mediaDir guess.
    const fallback = timelineToFcpxml(state, { mediaDir: uploads });
    assert.equal(fileURLToPath(mediaRepSrc(fallback, 'original-media')!), join(uploads, `${stem}.normalized.mp4`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// ── Issue #27: asset start is the original's embedded timecode; clip starts and timeMaps count from it ──
{
  const tc = (value: number, timescale: number, timecode?: string, dropFrame = false): ExportMediaStart => (
    { value, timescale, dropFrame, ...(timecode ? { timecode } : {}) });
  const pal = tc(900_000, 25, '10:00:00:00');
  const ntscDf = tc(107_999_892, 30_000, '01:00:00;00', true);
  const bwf = tc(1_728_000_000, 48_000);
  const exactly = (time: string, num: bigint, den: bigint): boolean => {
    const [n = '', d = '1'] = time.replace(/s$/, '').split('/');
    return BigInt(n) * den === num * BigInt(d);
  };
  const assetOf = (xml: string, id: string) => xml.match(new RegExp(`<asset id="id-${id}"[\\s\\S]*?</asset>`))?.[0] ?? '';
  const assetStart = (xml: string, id: string) => assetOf(xml, id).match(/<asset [^>]*start="([^"]*)"/)?.[1];
  const repKinds = (xml: string, id: string) => [...assetOf(xml, id).matchAll(/kind="([^"]*)" src="([^"]*)"/g)]
    .map(([, kind, src]) => `${kind} ${fileURLToPath(src!)}`);
  const timeline = (fps: number, items: TimelineItem[], assets?: TimelineState['assets']): TimelineState => ({
    fps, width: 1920, height: 1080, selectedId: null, items, assets,
    tracks: { V1: { kind: 'video' }, V2: { kind: 'video' }, A1: { kind: 'audio' } }, trackOrder: ['V2', 'V1', 'A1'],
  });
  const video = (id: string, src: string, srcInFrame: number, extra: Partial<TimelineItem> = {}): TimelineItem => ({
    id, track: 'V1', src, srcInFrame, kind: 'video', startFrame: 40, durationInFrames: 20, name: id, ...extra,
  });
  const all: string[] = [];
  const exportWith = (state: TimelineState, mediaSources: Record<string, object>) => {
    const xml = timelineToFcpxml(state, { mediaDir: '/m', mediaSources: mediaSources as never });
    all.push(xml);
    return xml;
  };

  // 25 fps media at 10:00:00:00, two cuts: in-points count from the timecode, positions do not.
  const pal25 = exportWith(timeline(25, [
    video('cam', '/media/uploads/cam.mov', 0),
    video('cam2', '/media/uploads/cam.mov', 50, { track: 'V2', startFrame: 0 }),
  ]), { '/media/uploads/cam.mov': { path: '/Volumes/A001/cam.mov', pathStart: pal } });
  assert.equal(assetStart(pal25, 'cam'), '900000/25s', 'asset start = 10:00:00:00 at 25 fps');
  assert.deepEqual(clipsOf(pal25).map((clip) => [attr(clip, 'offset'), attr(clip, 'start'), attr(clip, 'tcFormat')]),
    [['0/25s', '900050/25s', 'NDF'], ['40/25s', '900000/25s', 'NDF']], 'clip start = timecode + in-point; offset untouched');

  // 29.97 drop-frame media: exact on a 30 fps timeline and on a 29.97 one.
  const df30 = exportWith(timeline(30, [video('df', '/media/uploads/df.mov', 60)]),
    { '/media/uploads/df.mov': { path: '/Volumes/B001/df.mov', originalPath: '/Volumes/B001/df.mov', pathStart: ntscDf, originalStart: ntscDf } });
  assert.equal(assetStart(df30, 'df'), '107999892/30000s', '01:00:00;00 DF = frame 107892 × 1001/30000 s');
  assert.equal(attr(clipsOf(df30)[0]!, 'start'), '108059892/30000s', '60 frames at 30 fps past 01:00:00;00');
  assert.equal(attr(clipsOf(df30)[0]!, 'tcFormat'), 'DF');
  const df2997 = exportWith(timeline(29.97, [video('df', '/media/uploads/df.mov', 0), video('df2', '/media/uploads/df.mov', 30, { track: 'V2' })]),
    { '/media/uploads/df.mov': { path: '/Volumes/B001/df.mov', pathStart: ntscDf } });
  const [late, early] = clipsOf(df2997).map((clip) => attr(clip, 'start'));
  assert.equal(early, '107999892/30000s', 'in-point 0 is the timecode itself');
  assert.ok(exactly(late!, 107_999_892n * 29_970n + 30_000n * 30_000n, 30_000n * 29_970n),
    `30 frames at 29.97 past the timecode, exact (${late})`);

  // Retime on a timecoded file: the map starts at the file's timecode, the clip start is in the retimed clock.
  for (const [fps, source, rate] of [[25, pal, 2], [30, ntscDf, 1.5], [29.97, ntscDf, 0.5]] as const) {
    const retimed = exportWith(timeline(fps, [video('fast', '/media/uploads/cam.mov', 48, { playbackRate: rate })]),
      { '/media/uploads/cam.mov': { path: '/Volumes/A001/cam.mov', pathStart: source } });
    const origin = `${source.value}/${source.timescale}s`;
    assert.match(retimed, new RegExp(`<timept time="${origin}" value="${origin}" interp="linear"/>`),
      `${rate}x at ${fps} fps: the map starts at the asset start (the file's timecode)`);
    assert.ok(sameQ(sourceFrameAt(retimed, 'fast', 0, fps), qOf(48)),
      `${rate}x at ${fps} fps: the first frame samples timecode + in-point (got ${showQ(sourceFrameAt(retimed, 'fast', 0, fps))})`);
    assert.ok(sameQ(sourceFrameAt(retimed, 'fast', 19, fps), qOf(48 + 19 * rate)),
      `${rate}x at ${fps} fps: the last frame samples timecode + in-point + 19 × speed`);
  }

  // Broadcast WAV: a sample-accurate start and no timecode label (no tcFormat); transcript segments count from it.
  const transcript = [{ text: 'a', start: 0, end: 1000 }, { text: 'um', start: 1000, end: 3000 }, { text: 'b', start: 3000, end: 4000 }];
  const segments = keptSegments(transcript, new Set([1]), 30, 0, {});
  const wav = exportWith(timeline(30, [{
    id: 'vo', track: 'A1', startFrame: 0, durationInFrames: segments.reduce((sum, seg) => sum + seg.durFrames, 0),
    kind: 'audio', name: 'vo', src: '/media/uploads/vo.wav', transcript, deletedWordIdx: [1],
  }]), { '/media/uploads/vo.wav': { path: '/Volumes/SD/vo.wav', pathStart: bwf } });
  assert.equal(assetStart(wav, 'vo'), '1728000000/48000s');
  assert.deepEqual(clipsOf(wav).map((clip) => [attr(clip, 'start'), attr(clip, 'tcFormat')]),
    segments.map((seg) => [`${1_728_000_000 + seg.srcStartFrame * 1600}/48000s`, '']), 'each kept segment counts from the BWF start');

  // One start per asset: the working copy is the proxy only when it runs on the original's clock.
  const proxies = exportWith(timeline(25, [
    video('moved', '/media/uploads/m.normalized.mp4', 0),
    video('same', '/media/uploads/s.normalized.mp4', 0, { track: 'V2' }),
    video('drop', '/media/uploads/d.mp4', 0, { originalFilePath: '/Users/me/card/d.mov' }),
    video('bare', '/media/uploads/b.normalized.mp4', 0, { track: 'V2', startFrame: 0 }),
  ]), {
    '/media/uploads/m.normalized.mp4': { path: '/m/m.normalized.mp4', originalPath: '/Volumes/C/m.mov', pathStart: tc(90_000, 25, '01:00:00:00'), originalStart: pal },
    '/media/uploads/s.normalized.mp4': { path: '/m/s.normalized.mp4', originalPath: '/Volumes/C/s.mov', pathStart: tc(36_000, 1, '10:00:00:00'), originalStart: pal },
    '/media/uploads/d.mp4': { path: '/m/d.mp4', pathStart: pal },
    '/media/uploads/b.normalized.mp4': { path: '/m/b.normalized.mp4', originalPath: '/Volumes/C/b.mov', pathStart: pal },
  });
  assert.deepEqual([assetStart(proxies, 'moved'), repKinds(proxies, 'moved')], ['900000/25s', ['original-media /Volumes/C/m.mov']],
    'a copy on another clock is not offered as proxy; the asset keeps the original\'s start');
  assert.deepEqual([assetStart(proxies, 'same'), repKinds(proxies, 'same')],
    ['900000/25s', ['original-media /Volumes/C/s.mov', 'proxy-media /m/s.normalized.mp4']], 'the same instant in another timescale matches');
  assert.deepEqual([assetStart(proxies, 'drop'), repKinds(proxies, 'drop')],
    ['900000/25s', ['original-media /Users/me/card/d.mov', 'proxy-media /m/d.mp4']], 'a drag/drop original runs on its copy\'s clock');
  assert.deepEqual([assetStart(proxies, 'bare'), repKinds(proxies, 'bare')], ['0s', ['original-media /Volumes/C/b.mov']],
    'an original without a timecode starts at 0s, and a timecoded copy cannot be its proxy');

  // Untagged media keeps the existing output.
  const untagged = exportWith(timeline(25, [video('u', '/media/uploads/u.mp4', 50)]), { '/media/uploads/u.mp4': { path: '/m/u.mp4' } });
  assert.equal(assetStart(untagged, 'u'), '0s');
  assert.deepEqual([attr(clipsOf(untagged)[0]!, 'start'), attr(clipsOf(untagged)[0]!, 'tcFormat')], ['50/25s', '']);

  for (const xml of all) assert.deepEqual(fcpxmlDtdViolations(xml), [], 'timecoded exports validate against the FCPXML 1.10 DTD');
}

// ── Issue #27: the renderer asks the server once per export and never trusts a malformed answer ──
{
  const calls: Array<{ url: string; body: unknown }> = [];
  const answer = (payload: unknown, status = 200): typeof fetch => (async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(payload), { status });
  }) as typeof fetch;
  const located = { '/media/uploads/a.mp4': { path: '/Volumes/\u5a92\u4f53/a.mov', originalPath: '/Volumes/\u5a92\u4f53/a.mov' } };
  assert.deepEqual(await exportMediaSources(['/media/uploads/a.mp4', 'https://cdn/x.mp4', '/media/uploads/a.mp4'],
    answer({ ok: true, sources: located })), located);
  assert.deepEqual(calls, [{ url: EXPORT_MEDIA_SOURCES_ROUTE, body: { sources: ['/media/uploads/a.mp4'] } }],
    'one POST with the distinct upload sources only');
  assert.deepEqual(await exportMediaSources(['blob:x', 'https://cdn/y.mp4'], answer({})), {}, 'nothing to resolve');
  assert.equal(calls.length, 1, 'no request without upload sources');
  assert.deepEqual(await exportMediaSources(['/media/uploads/a.mp4'], answer({ error: 'boom' }, 500)), {});
  assert.deepEqual(await exportMediaSources(['/media/uploads/a.mp4'],
    answer({ ok: true, sources: { '/media/uploads/a.mp4': { path: 'relative/a.mov' } } })), {}, 'relative paths are rejected');
  assert.deepEqual(await exportMediaSources(['/media/uploads/a.mp4'],
    (async () => { throw new TypeError('offline'); }) as typeof fetch), {}, 'network failure falls back to mediaDir');
  const start = { value: 900_000, timescale: 25, timecode: '10:00:00:00', dropFrame: false };
  const timed = { '/media/uploads/a.mp4': { path: '/Volumes/A/a.mov', pathStart: start, originalStart: { value: 1, timescale: 48_000, dropFrame: false } } };
  assert.deepEqual(await exportMediaSources(['/media/uploads/a.mp4'], answer({ ok: true, sources: timed })), timed,
    'start timecodes come through');
  for (const bad of [{ ...start, value: 1.5 }, { ...start, value: -1 }, { ...start, timescale: 0 },
    { value: 1, timescale: 25 }, { ...start, timecode: '0'.repeat(33) }, 'start']) {
    assert.deepEqual(await exportMediaSources(['/media/uploads/a.mp4'],
      answer({ ok: true, sources: { '/media/uploads/a.mp4': { path: '/Volumes/A/a.mov', pathStart: bad } } })), {},
    `a malformed start is rejected: ${JSON.stringify(bad)}`);
  }
  const locations = await fcpxmlMediaLocations({
    items: [{ id: 'v', track: 'V1', startFrame: 0, durationInFrames: 1, kind: 'video', name: 'v', src: '/media/uploads/a.mp4' }],
  }, answer({ ok: true, sources: located }));
  assert.deepEqual(locations.mediaSources, located, 'timeline item sources are what gets resolved');

  // Cancelling the export ends the wait for the server at once instead of
  // holding the export open until the lookup's own timeout.
  const cancel = new AbortController();
  let seen: AbortSignal | null | undefined;
  const hanging = ((_url, init) => new Promise<Response>((_resolve, reject) => {
    seen = init?.signal;
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  const pending = exportMediaSources(['/media/uploads/a.mp4'], hanging, cancel.signal);
  cancel.abort();
  let hung: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    pending.then((value) => ({ value })),
    new Promise<'hung'>((resolve) => { hung = setTimeout(() => resolve('hung'), 1_000); }),
  ]);
  clearTimeout(hung);
  assert.deepEqual(outcome, { value: {} }, 'a cancelled lookup settles at once with the mediaDir fallback');
  assert.equal(seen?.aborted, true, "the export's signal reaches the request");
  let forwarded: AbortSignal | null | undefined;
  await fcpxmlMediaLocations({
    items: [{ id: 'v', track: 'V1', startFrame: 0, durationInFrames: 1, kind: 'video', name: 'v', src: '/media/uploads/a.mp4' }],
  }, (async (_url, init) => { forwarded = init?.signal; throw new DOMException('aborted', 'AbortError'); }) as typeof fetch,
  AbortSignal.abort());
  assert.equal(forwarded?.aborted, true, 'fcpxmlMediaLocations forwards the export signal');
}

// ── Resolve variants retain existing differences ──
{
  const state: TimelineState = {
    fps: 30, width: 1920, height: 1080, selectedId: null,
    items: [{ id: 'a', track: 'A1', startFrame: 0, durationInFrames: 30, kind: 'audio', name: 'a', src: '/media/uploads/a.mp3' }],
  };
  const resolveXml = timelineToFcpxml(state, { nleFormat: 'fcp_xml_resolve' });
  assert.ok(resolveXml.includes('colorSpace="1-1-1 (Rec. 709)"'), 'Resolve \u53d8\u4f53\u5e26 Rec.709');
  assert.ok(resolveXml.includes('<event name="AfterFrame Export (Resolve)">'), 'Resolve \u4e8b\u4ef6\u540d');
  assert.ok(!timelineToFcpxml(state).includes('colorSpace'), '\u9ed8\u8ba4\u53d8\u4f53\u4e0d\u5e26 colorSpace');
}

console.log('fcpxml.verify: ok (\u7ed3\u6784/\u8f6c\u4e49/lane/\u5206\u6bb5/\u539f\u59cb\u4e0e\u4ee3\u7406\u5a92\u4f53/FCPXML 1.10 DTD/src \u7f16\u7801/\u5f15\u7528\u7d20\u6750\u539f\u7247/\u8d77\u59cb\u65f6\u95f4\u7801/Resolve \u53d8\u4f53)');
