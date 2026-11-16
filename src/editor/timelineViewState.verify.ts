import assert from 'node:assert/strict';
import {
  clearTimelineViewStates,
  loadTimelineViewState,
  saveTimelineViewState,
  type TimelineViewStorage,
} from './timelineViewState';

class MemoryStorage implements TimelineViewStorage {
  private readonly values: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.values[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.values[key] = value;
  }

  removeItem(key: string): void {
    delete this.values[key];
  }
}

const storage = new MemoryStorage();
assert.equal(loadTimelineViewState(storage, 'project-a', 'timeline-a'), null, '\u65e0\u8bb0\u5f55\u7684 timeline \u5fc5\u987b\u8d70 fit/default，\u800c\u4e0d\u662f\u7ee7\u627f\u522b\u7684 timeline');

saveTimelineViewState(storage, 'project-a', 'timeline-a', {
  playhead: 120,
  zoom: 2.25,
  scrollLeft: 640,
  trackScale: 1.4,
});
saveTimelineViewState(storage, 'project-a', 'timeline-b', {
  playhead: 8,
  zoom: 0.75,
  scrollLeft: 24,
  trackScale: 0.8,
});

assert.deepEqual(loadTimelineViewState(storage, 'project-a', 'timeline-a'), {
  playhead: 120,
  zoom: 2.25,
  scrollLeft: 640,
  trackScale: 1.4,
});
assert.deepEqual(loadTimelineViewState(storage, 'project-a', 'timeline-b'), {
  playhead: 8,
  zoom: 0.75,
  scrollLeft: 24,
  trackScale: 0.8,
});

// Simulate A → B → A switching. A's exact view returns; B never leaks its frame or zoom into A.
const switchedToB = loadTimelineViewState(storage, 'project-a', 'timeline-b');
const switchedBackToA = loadTimelineViewState(storage, 'project-a', 'timeline-a');
assert.equal(switchedToB?.playhead, 8);
assert.equal(switchedBackToA?.playhead, 120);
assert.equal(switchedBackToA?.zoom, 2.25);
assert.equal(switchedBackToA?.scrollLeft, 640);
assert.equal(switchedBackToA?.trackScale, 1.4);

// Independent writers (playhead paint and zoom/scroll controller) merge without flattening the other fields.
saveTimelineViewState(storage, 'project-a', 'timeline-a', { playhead: 144 });
assert.deepEqual(loadTimelineViewState(storage, 'project-a', 'timeline-a'), {
  playhead: 144,
  zoom: 2.25,
  scrollLeft: 640,
  trackScale: 1.4,
});
assert.equal(loadTimelineViewState(storage, 'project-b', 'timeline-a'), null, 'project id is also part of the persistence boundary');

clearTimelineViewStates(storage, 'project-a');
assert.equal(loadTimelineViewState(storage, 'project-a', 'timeline-a'), null);
assert.equal(loadTimelineViewState(storage, 'project-a', 'timeline-b'), null);

console.log('timelineViewState.verify: ok (timelineId \u9694\u79bb/\u5207\u6362\u6062\u590d/partial merge/\u9879\u76ee\u6e05\u7406)');
