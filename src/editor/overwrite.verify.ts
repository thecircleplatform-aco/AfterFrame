import { CURRENT_PROJECT_VERSION } from '../../shared/project-version';
import assert from 'node:assert/strict';
import { historyReduce, reduce } from './reduce';
import { planOverwrite } from './overwrite';
import type { ProjectDoc, TimelineItem, TimelineState, TransitionItem } from './types';

const clip = (id: string, startFrame: number, durationInFrames: number, extra: Partial<TimelineItem> = {}): TimelineItem => ({
  id,
  track: 'V1',
  startFrame,
  durationInFrames,
  kind: 'video',
  name: id,
  src: `/media/uploads/${id}.mp4`,
  ...extra,
});

const stateOf = (items: TimelineItem[], transitions: TransitionItem[] = []): TimelineState => ({
  fps: 30,
  width: 1920,
  height: 1080,
  items,
  transitions,
  selectedId: null,
  tracks: { V1: { kind: 'video' } },
  trackOrder: ['V1'],
});

const inserted = (id: string, durationInFrames: number): Omit<TimelineItem, 'startFrame'> => ({
  id,
  track: 'V1',
  durationInFrames,
  kind: 'video',
  name: id,
  src: `/media/uploads/${id}.mp4`,
});

const audioCompanion = (id: string, startFrame: number, durationInFrames: number): TimelineItem =>
  clip(id, startFrame, durationInFrames, {
    track: 'A1',
    kind: 'audio',
    src: `/media/uploads/${id}.wav`,
  });

function linkedStateOf(
  target: TimelineItem,
  companion: TimelineItem,
  locked: { target?: boolean; companion?: boolean } = {},
): TimelineState {
  return {
    ...stateOf([target, companion]),
    tracks: {
      V1: { kind: 'video', ...(locked.target ? { locked: true } : {}) },
      A1: { kind: 'audio', ...(locked.companion ? { locked: true } : {}) },
    },
    trackOrder: ['V1', 'A1'],
    linkGroups: [{
      id: `link-${target.id}`,
      itemIds: [target.id, companion.id],
      anchorItemId: target.id,
      mode: 'linked',
    }],
  };
}

function assertNoTrackOverlap(state: TimelineState): void {
  const ordered = state.items.filter((item) => item.track === 'V1')
    .toSorted((left, right) => left.startFrame - right.startFrame);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    assert.ok(previous.startFrame + previous.durationInFrames <= current.startFrame,
      `${previous.id} \u4e0e ${current.id} \u4e0d\u5e94\u91cd\u53e0`);
  }
}

function assertValidLinkGroups(state: TimelineState): void {
  const existingIds = new Set(state.items.map((item) => item.id));
  for (const group of state.linkGroups ?? []) {
    assert.ok(group.itemIds.length >= 2, `${group.id} \u4e0d\u5e94\u4fdd\u7559\u5355\u6210\u5458 group`);
    assert.equal(new Set(group.itemIds).size, group.itemIds.length, `${group.id} \u4e0d\u5e94\u542b\u91cd\u590d\u6210\u5458`);
    assert.ok(group.itemIds.includes(group.anchorItemId), `${group.id} anchor \u5fc5\u987b\u4ecd\u662f\u6210\u5458`);
    assert.ok(group.itemIds.every((id) => existingIds.has(id)), `${group.id} \u4e0d\u5e94\u542b dangling id`);
  }
}

let sequence = 0;
const nextId = () => `split-${sequence += 1}`;

// New range fully contains old → remove.
{
  const source = stateOf([clip('old', 12, 6)]);
  const plan = planOverwrite(source, inserted('new', 10), 10, nextId)!;
  const next = plan.actions.reduce(reduce, source);
  assert.equal(next.items.some((item) => item.id === 'old'), false);
  assert.deepEqual(next.items.map((item) => [item.id, item.startFrame, item.durationInFrames]), [['new', 10, 10]]);
  assertNoTrackOverlap(next);
}

// New range covers old's left edge → retain right fragment and advance source by playback rate.
{
  const source = stateOf([clip('old', 15, 10, { srcInFrame: 10, playbackRate: 2 })]);
  const plan = planOverwrite(source, inserted('new', 10), 10, nextId)!;
  const next = plan.actions.reduce(reduce, source);
  const right = next.items.find((item) => item.id === 'old')!;
  assert.deepEqual([right.startFrame, right.durationInFrames, right.srcInFrame], [20, 5, 20], '5 \u4e2a timeline frame \u5e94\u63a8\u8fdb 10 \u4e2a source frame');
  assertNoTrackOverlap(next);
}

// Word-driven transcript audio keeps its timeline-word window semantics instead of multiplying by playback rate.
{
  const source = stateOf([clip('old', 15, 10, {
    kind: 'audio',
    srcInFrame: 10,
    playbackRate: 2,
    transcript: [{ text: 'word', start: 0, end: 1000 }],
  })]);
  const plan = planOverwrite(source, inserted('new', 10), 10, nextId)!;
  const next = plan.actions.reduce(reduce, source);
  assert.equal(next.items.find((item) => item.id === 'old')?.srcInFrame, 15,
    'word-driven audio \u7684 5 \u4e2a timeline frame \u4ecd\u63a8\u8fdb 5 \u4e2a\u8bcd\u6d41 frame');
}

// New range covers old's right edge → retain left fragment without moving it.
{
  const source = stateOf([clip('old', 5, 10, { srcInFrame: 7 })]);
  const plan = planOverwrite(source, inserted('new', 10), 10, nextId)!;
  const next = plan.actions.reduce(reduce, source);
  const left = next.items.find((item) => item.id === 'old')!;
  assert.deepEqual([left.startFrame, left.durationInFrames, left.srcInFrame], [5, 5, 7]);
  assertNoTrackOverlap(next);
}

// New range cuts a hole in the middle → original left + source-correct right split + insert.
{
  const source = stateOf([clip('old', 5, 20, { srcInFrame: 4, playbackRate: 2 })]);
  const plan = planOverwrite(source, inserted('new', 10), 10, nextId)!;
  const next = plan.actions.reduce(reduce, source);
  const ordered = next.items.toSorted((left, right) => left.startFrame - right.startFrame);
  assert.deepEqual(ordered.map((item) => [item.startFrame, item.durationInFrames]), [[5, 5], [10, 10], [20, 5]]);
  assert.equal(ordered[2]?.srcInFrame, 34, 'right fragment source in = 4 + 15×2');
  assertNoTrackOverlap(next);
}

// A middle-hole overwrite keeps a transition at the original right edge by
// remapping its outgoing endpoint through both splits to the final right fragment.
{
  const transition: TransitionItem = {
    id: 'tr', type: 'cross-dissolve', durationInFrames: 6,
    outgoingItemId: 'old', incomingItemId: 'next', trackId: 'V1',
  };
  const source = stateOf([clip('old', 0, 30), clip('next', 30, 10)], [transition]);
  const plan = planOverwrite(source, inserted('new', 10), 10, nextId)!;
  const next = plan.actions.reduce(reduce, source);
  const right = next.items.find((item) => (
    item.id !== 'new' && item.id !== 'next' && item.startFrame === 20
  ))!;
  assert.deepEqual(next.transitions, [{ ...transition, outgoingItemId: right.id }]);
  assert.equal(right.startFrame + right.durationInFrames, 30, 'right fragment \u5e94\u4fdd\u6301\u539f\u672b\u7aef seam');
  assert.equal(next.transitions?.[0]?.durationInFrames, transition.durationInFrames);
  assert.ok(next.transitions?.every((entry) => (
    next.items.some((item) => item.id === entry.outgoingItemId)
    && next.items.some((item) => item.id === entry.incomingItemId)
  )));
  assertNoTrackOverlap(next);

  const timeline = { ...source, id: 'tl1', name: 'main', order: 0 };
  const doc: ProjectDoc = { version: CURRENT_PROJECT_VERSION, assets: [], mediaFolders: [], timelines: [timeline], activeTimelineId: 'tl1' };
  const committed = historyReduce({ past: [], present: doc, future: [] }, { type: 'batch', label: 'Overwrite clip', actions: plan.actions });
  assert.equal(committed.past.length, 1, 'overwrite \u7684\u6240\u6709 split/trim/remove/add \u53ea\u5360\u4e00\u4e2a undo step');
  const undone = historyReduce(committed, { type: 'undo' });
  assert.deepEqual(undone.present, doc);
}

// Generic middle split uses the same endpoint rule: incoming stays on the
// original left id, outgoing follows the new right id, and both seams survive.
{
  const incoming: TransitionItem = {
    id: 'generic-in', type: 'cross-dissolve', durationInFrames: 4,
    outgoingItemId: 'generic-prev', incomingItemId: 'generic-old', trackId: 'V1',
  };
  const outgoing: TransitionItem = {
    id: 'generic-out', type: 'cross-dissolve', durationInFrames: 6,
    outgoingItemId: 'generic-old', incomingItemId: 'generic-next', trackId: 'V1',
  };
  const source = stateOf([
    clip('generic-prev', 0, 10),
    clip('generic-old', 10, 30),
    clip('generic-next', 40, 10),
  ], [incoming, outgoing]);
  const next = reduce(source, {
    type: 'split',
    id: 'generic-old',
    atFrame: 20,
    newId: 'generic-right',
  });
  assert.deepEqual(next.transitions, [
    incoming,
    { ...outgoing, outgoingItemId: 'generic-right' },
  ]);
  assert.equal(next.items.find((item) => item.id === 'generic-old')?.startFrame, 10);
  assert.deepEqual(
    next.items
      .filter((item) => item.id === 'generic-old' || item.id === 'generic-right')
      .map((item) => [item.id, item.startFrame, item.durationInFrames]),
    [['generic-old', 10, 10], ['generic-right', 20, 20]],
  );
}

// Boundary overwrite semantics stay evidence-based: retaining the original
// right edge preserves its outgoing transition; changing/removing it deletes
// the transition instead of guessing that the inserted clip inherited it.
{
  const scenarios = [
    { name: 'head', oldStart: 10, oldDuration: 20, nextStart: 30, insertStart: 0, insertDuration: 20, preserve: true },
    { name: 'tail', oldStart: 0, oldDuration: 20, nextStart: 20, insertStart: 10, insertDuration: 10, preserve: false },
    { name: 'full', oldStart: 10, oldDuration: 10, nextStart: 20, insertStart: 10, insertDuration: 10, preserve: false },
  ];
  for (const scenario of scenarios) {
    const oldId = `boundary-${scenario.name}-old`;
    const nextIdAtBoundary = `boundary-${scenario.name}-next`;
    const transition: TransitionItem = {
      id: `boundary-${scenario.name}-tr`,
      type: 'cross-dissolve',
      durationInFrames: 6,
      outgoingItemId: oldId,
      incomingItemId: nextIdAtBoundary,
      trackId: 'V1',
    };
    const source = stateOf([
      clip(oldId, scenario.oldStart, scenario.oldDuration),
      clip(nextIdAtBoundary, scenario.nextStart, 10),
    ], [transition]);
    const plan = planOverwrite(
      source,
      inserted(`boundary-${scenario.name}-new`, scenario.insertDuration),
      scenario.insertStart,
      nextId,
    )!;
    const next = plan.actions.reduce(reduce, source);
    assert.deepEqual(next.transitions, scenario.preserve ? [transition] : [],
      `${scenario.name} overwrite \u7684 outgoing transition \u5e94\u6309\u539f\u53f3\u8fb9\u754c\u662f\u5426\u4fdd\u7559\u51b3\u5b9a`);
    assertNoTrackOverlap(next);
  }
}

// Linked A/V overwrite is lane-only in all four geometries: the audio companion
// never moves, target fragments vacate the overwrite range, and the stale link is removed.
{
  const scenarios = [
    { name: 'full', targetStart: 12, targetDuration: 6, expectedFragments: [] },
    { name: 'head', targetStart: 15, targetDuration: 10, expectedFragments: [[20, 5]] },
    { name: 'tail', targetStart: 5, targetDuration: 10, expectedFragments: [[5, 5]] },
    { name: 'middle', targetStart: 5, targetDuration: 20, expectedFragments: [[5, 5], [20, 5]] },
  ];
  for (const scenario of scenarios) {
    const target = clip(`target-${scenario.name}`, scenario.targetStart, scenario.targetDuration);
    const companion = audioCompanion(
      `companion-${scenario.name}`,
      scenario.targetStart,
      scenario.targetDuration,
    );
    const source = linkedStateOf(target, companion);
    const newId = `new-${scenario.name}`;
    const plan = planOverwrite(source, inserted(newId, 10), 10, nextId);
    assert.ok(plan, `${scenario.name} linked overwrite \u5e94\u6210\u529f`);
    const next = plan.actions.reduce(reduce, source);
    const fragments = next.items
      .filter((item) => item.track === 'V1' && item.id !== newId)
      .toSorted((left, right) => left.startFrame - right.startFrame);

    assert.deepEqual(next.items.find((item) => item.id === companion.id), companion,
      `${scenario.name} companion \u51e0\u4f55\u548c\u5a92\u4f53\u5c5e\u6027\u5fc5\u987b\u4e0d\u53d8`);
    assert.deepEqual(
      fragments.map((item) => [item.startFrame, item.durationInFrames]),
      scenario.expectedFragments,
      `${scenario.name} target fragments \u5e94\u7cbe\u786e\u4fdd\u7559\u8986\u76d6\u533a\u4e24\u4fa7`,
    );
    assert.ok(fragments.every((item) => (
      item.startFrame + item.durationInFrames <= 10 || item.startFrame >= 20
    )), `${scenario.name} \u65e7 target \u4e0d\u5f97\u6b8b\u7559\u5728\u8986\u76d6\u533a`);
    assert.deepEqual(
      next.items
        .filter((item) => item.id === newId)
        .map((item) => [item.track, item.startFrame, item.durationInFrames]),
      [['V1', 10, 10]],
      `${scenario.name} \u5e94\u53ea\u63d2\u5165\u4e00\u4e2a\u7cbe\u786e\u8986\u76d6\u7684\u65b0\u7247`,
    );
    assert.equal(next.linkGroups, undefined, `${scenario.name} \u53d8\u5f62 target \u5e94\u9000\u51fa\u539f linked group`);
    assertNoTrackOverlap(next);
    assertValidLinkGroups(next);
  }
}

// A locked target lane rejects the whole overwrite without mutating the source snapshot.
{
  const target = clip('locked-target', 5, 20);
  const companion = audioCompanion('locked-target-companion', 5, 20);
  const source = linkedStateOf(target, companion, { target: true });
  const before = JSON.parse(JSON.stringify(source)) as TimelineState;
  assert.equal(planOverwrite(source, inserted('locked-new', 10), 10, nextId), null);
  assert.deepEqual(source, before);
}

// A locked linked companion is not part of the target lane transaction and remains untouched.
{
  const target = clip('unlocked-target', 5, 20, { srcInFrame: 3 });
  const companion = audioCompanion('locked-companion', 5, 20);
  const source = linkedStateOf(target, companion, { companion: true });
  const plan = planOverwrite(source, inserted('companion-lock-new', 10), 10, nextId);
  assert.ok(plan, '\u4ec5 companion \u9501\u8f68\u65f6 lane-only overwrite \u4ecd\u5e94\u6210\u529f');
  const next = plan.actions.reduce(reduce, source);
  assert.deepEqual(next.items.find((item) => item.id === companion.id), companion);
  assert.deepEqual(
    next.items
      .filter((item) => item.track === 'V1' && item.id !== 'companion-lock-new')
      .toSorted((left, right) => left.startFrame - right.startFrame)
      .map((item) => [item.startFrame, item.durationInFrames]),
    [[5, 5], [20, 5]],
  );
  assert.equal(next.linkGroups, undefined);
  assertNoTrackOverlap(next);
  assertValidLinkGroups(next);
}

// If an exact planned trim cannot be applied, planning rejects before the add step.
{
  const source = stateOf([clip('short-word-source', 15, 10, {
    kind: 'audio',
    src: '/media/uploads/short-word-source.wav',
    transcript: [{ text: 'short', start: 0, end: 100 }],
  })]);
  const before = JSON.parse(JSON.stringify(source)) as TimelineState;
  assert.equal(planOverwrite(source, inserted('must-not-add', 10), 10, nextId), null);
  assert.deepEqual(source, before);
  assert.equal(source.items.some((item) => item.id === 'must-not-add'), false);
}

console.log('overwrite.verify: ok (\u56db\u533a\u57df/lane-only linked A/V/split transition endpoint/\u9501\u8f68\u539f\u5b50\u62d2\u7edd/\u65e0\u91cd\u53e0/linkGroups \u5408\u6cd5/\u5355\u6b21 undo)');
