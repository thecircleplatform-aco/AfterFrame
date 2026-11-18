// Verifies that change sessions are attributed to the turn that produced them.
//
// The reason this matters: a rewind truncates the conversation and rolls back
// timeline edits. The confirm dialog has to name *exactly* the edits it is about
// to undo. Positional guessing (newest N sessions) breaks as soon as one turn
// writes more than one session, which pool imports routinely do.
import assert from 'node:assert/strict';
import { CURRENT_PROJECT_VERSION } from '../../shared/project-version';
import { createAgentChangeSession, parseAgentChangeLog } from './changeLog.ts';
import type { ProjectDoc } from '../editor/types';

// A minimal but structurally valid doc: parseAgentChangeLog runs every row
// through migrateProjectDoc and silently drops anything it cannot migrate.
const doc = (width: number): ProjectDoc => ({
  version: CURRENT_PROJECT_VERSION,
  assets: [],
  mediaFolders: [],
  activeTimelineId: 'timeline',
  timelines: [{
    id: 'timeline', name: 'Sequence', order: 0, fps: 30, width, height: 1080,
    items: [], selectedId: null,
  }],
});

const before = doc(1920);
const after = doc(1080);

// Two turns, the first emitting two sessions (an import batch plus an edit).
const turnA = 'turn-a';
const turnB = 'turn-b';
const edit1 = createAgentChangeSession('Import pool media', [], before, after, true, turnA);
const edit2 = createAgentChangeSession('Tighten the cut', [], before, after, true, turnA);
const edit3 = createAgentChangeSession('Add captions', [], before, after, true, turnB);

const log = [edit1, edit2, edit3];

// Attribution is by id, so a multi-session turn is fully captured — the case
// positional slicing got wrong.
const forA = log.filter((s) => s.turnId === turnA);
const forB = log.filter((s) => s.turnId === turnB);
assert.equal(forA.length, 2, 'both sessions of turn A must be attributed to it');
assert.equal(forB.length, 1, 'turn B owns exactly its own session');
assert.deepEqual(forA.map((s) => s.summary), ['Import pool media', 'Tighten the cut']);

// A session with no turnId (written before this field existed) must not be
// claimed by any turn.
const legacy = { ...edit3, turnId: undefined } as unknown as typeof edit3;
assert.equal(log.filter((s) => s.turnId === undefined).length, 0);
assert.equal([edit1, legacy].filter((s) => s.turnId === turnA).length, 1, 'legacy sessions are not misattributed');

// Round-trip: the field has to survive persistence or old ids vanish on reload.
const parsed = parseAgentChangeLog(log);
assert.equal(parsed.length, 3);
assert.equal(parsed[0].turnId, turnA);
assert.equal(parsed[1].turnId, turnA);
assert.equal(parsed[2].turnId, turnB);

// A persisted log from before the field existed still loads, with no turnId.
const legacyLog = parseAgentChangeLog(log.map(({ turnId, ...rest }) => rest));
assert.equal(legacyLog.length, 3, 'legacy rows must still parse');
assert.ok(legacyLog.every((s) => s.turnId === undefined), 'legacy rows carry no turnId');

// A malformed turnId must be dropped rather than stored as junk.
const junk = parseAgentChangeLog([{ ...edit1, turnId: 42 }]);
assert.equal(junk[0]?.turnId, undefined, 'non-string turnId is discarded');

console.log('changeTurnAttribution.verify: ok');
