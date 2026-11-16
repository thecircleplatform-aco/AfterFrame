// Runnable check: `npx tsx src/editor/snap.verify.ts`.
// Two new rules for verifying adsorption: (1) Hysteresis - after being sucked, you have to go out of 1.5 times the radius before releasing, otherwise it will be on the boundary
// It will shake back and forth; (2) Weighted by type - the adsorption radius of the play head is larger, and it wins when it is equidistant.
import assert from 'node:assert/strict';
import {
  findClosestSnapPoint, snapDraggedEdges, sortTimelineSnapPoints, STICKY_RELEASE, type SnapPoint,
} from './snap';

const THRESHOLD = 4; // frame
const base = { baseStart: 100, baseDuration: 50, points: [] as SnapPoint[], thresholdFrames: THRESHOLD };

// ── Weighted: When isometric the playhead wins over the edge of the clip, and its radius is indeed wider ──
{
  const points: SnapPoint[] = [
    { frame: 100, type: 'item-end', itemId: 'x' },
    { frame: 108, type: 'playhead' },
  ];
  assert.equal(findClosestSnapPoint(points, 104, THRESHOLD)?.type, 'playhead', '\u5404\u5dee 4 \u5e27\u65f6\u64ad\u653e\u5934\u4f18\u5148');

  const farPlayhead: SnapPoint[] = [{ frame: 106, type: 'playhead' }];
  assert.equal(findClosestSnapPoint(farPlayhead, 100, THRESHOLD)?.type, 'playhead', '6 \u5e27\u4ecd\u5728\u64ad\u653e\u5934\u7684 1.5 \u500d\u534a\u5f84\u5185');
  const farEdge: SnapPoint[] = [{ frame: 106, type: 'item-end', itemId: 'x' }];
  assert.equal(findClosestSnapPoint(farEdge, 100, THRESHOLD), null, '\u540c\u6837 6 \u5e27,\u7247\u6bb5\u8fb9\u7f18\u5df2\u7ecf\u591f\u4e0d\u7740');
}

// ── Hysteresis: Move slightly after sucking and still bite the same frame ──
{
  const points: SnapPoint[] = [{ frame: 120, type: 'item-start', itemId: 'x' }];
  const first = snapDraggedEdges({ ...base, points, mode: 'move', rawDelta: 18 }); // Probe 118
  assert.equal(first.snapAt, 120, '\u8fdb\u5165\u534a\u5f84\u5148\u5438\u4f4f');
  assert.equal(first.deltaF, 20);
  assert.ok(first.hold);

  // Go outside 5 frames: if there is no hysteresis, it will be released (exceeding the threshold 4), if there is hysteresis, it will continue to bite (but not past 4×1.5=6)
  const held = snapDraggedEdges({ ...base, points, mode: 'move', rawDelta: 25, hold: first.hold });
  assert.equal(held.snapAt, 120, '\u672a\u8d70\u51fa\u91ca\u653e\u534a\u5f84,\u4fdd\u6301\u5438\u9644');
  assert.equal(held.deltaF, 20);

  const released = snapDraggedEdges({ ...base, points, mode: 'move', rawDelta: 27, hold: first.hold });
  assert.equal(released.snapAt, null, '\u8d70\u51fa 1.5 \u500d\u534a\u5f84\u540e\u677e\u5f00');
  assert.equal(released.deltaF, 27, '\u677e\u5f00\u540e\u56de\u5230\u539f\u59cb\u4f4d\u79fb');

  // Do not pass hold = old behavior: the same displacement will not bite
  const stateless = snapDraggedEdges({ ...base, points, mode: 'move', rawDelta: 25 });
  assert.equal(stateless.snapAt, null);
}

// ── If the adsorption target disappears (for example, the clip is deleted), you must release it immediately, and you cannot bite the ghost ──
{
  const hold = { frame: 120, edge: 'start' as const, type: 'item-start' as const };
  const gone = snapDraggedEdges({ ...base, points: [], mode: 'move', rawDelta: 21, hold });
  assert.equal(gone.snapAt, null);
  assert.equal(gone.deltaF, 21);
}

// ── Hold remembers which side: trim-left should not inherit the record that is sucked at the end when move ──
{
  const points: SnapPoint[] = [{ frame: 155, type: 'item-start', itemId: 'x' }];
  const moved = snapDraggedEdges({ ...base, points, mode: 'move', rawDelta: 4 }); // Tail edge probe 154
  assert.equal(moved.hold?.edge, 'end', 'move \u65f6\u5438\u4f4f\u7684\u662f\u5c3e\u8fb9');
  const trimmed = snapDraggedEdges({ ...base, points, mode: 'trim-left', rawDelta: 4, hold: moved.hold });
  assert.equal(trimmed.snapAt, null, 'trim-left \u53ea\u770b\u5934\u8fb9,\u5c3e\u8fb9\u7684 hold \u4e0d\u9002\u7528');
}

// ── trim-right only detects the tail edge, and there is still hysteresis ──
{
  const points: SnapPoint[] = [{ frame: 160, type: 'item-end', itemId: 'x' }];
  const first = snapDraggedEdges({ ...base, points, mode: 'trim-right', rawDelta: 8 }); // tail edge 158
  assert.equal(first.snapAt, 160);
  assert.equal(first.deltaF, 10);
  const held = snapDraggedEdges({ ...base, points, mode: 'trim-right', rawDelta: 15, hold: first.hold });
  assert.equal(held.snapAt, 160, `\u91ca\u653e\u534a\u5f84\u662f ${THRESHOLD * STICKY_RELEASE} \u5e27`);
}

// ── When there is no target at all, the displacement is returned ──
{
  const none = snapDraggedEdges({ ...base, points: [{ frame: 900, type: 'playhead' }], mode: 'move', rawDelta: 7 });
  assert.deepEqual([none.deltaF, none.snapAt, none.hold], [7, null, null]);
}

// ── Sorting + binary search is result-identical, including equal-distance tie order ──
{
  const points: SnapPoint[] = [
    { frame: 108, type: 'item-start', itemId: 'later-in-registry' },
    { frame: 92, type: 'item-end', itemId: 'earlier-in-registry' },
    { frame: 500, type: 'marker-start', markerId: 'far' },
  ];
  const probes = [88, 92, 96, 100, 104, 108, 112];
  const before = probes.map((frame) => findClosestSnapPoint(points, frame, 10));
  const sorted = sortTimelineSnapPoints(points);
  const after = probes.map((frame) => findClosestSnapPoint(sorted, frame, 10));
  assert.deepEqual(after, before, '\u6392\u5e8f\u540e\u4e8c\u5206\u641c\u7d22\u5fc5\u987b\u4fdd\u6301\u76f8\u7b49\u8ddd\u79bb\u4e0e\u8fb9\u754c\u7ed3\u679c');
  assert.equal(findClosestSnapPoint(sorted, 100, 10)?.itemId, 'earlier-in-registry');
}

console.log('snap.verify: ok (\u7c7b\u578b\u52a0\u6743/\u8fdf\u6ede\u4fdd\u6301\u4e0e\u91ca\u653e/\u76ee\u6807\u6d88\u5931\u5373\u677e\u5f00/\u8fb9\u5f52\u5c5e/trim-right)');
