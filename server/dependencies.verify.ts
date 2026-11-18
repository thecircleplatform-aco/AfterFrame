// Verifies the dependency registry and install gating.
//
// Two things must hold or the feature is dangerous rather than helpful:
// 1. inspectDependencies() must never claim "ready" for something absent — a
//    false positive sends the agent into a retry loop that cannot succeed.
// 2. installDependency() must refuse ids that have no pinned installer, so a
//    prompt-injected tool call cannot turn the endpoint into a command runner.
import assert from 'node:assert/strict';
import {
  canInstall, inspectDependencies, installDependency, isDependencyId,
} from './dependencies.ts';

const reports = await inspectDependencies();
assert.ok(reports.length >= 3, 'expected ffmpeg, whisper-cli and mediapipe reports');

const ids = reports.map((entry) => entry.id);
for (const expected of ['ffmpeg', 'whisper-cli', 'mediapipe'] as const) {
  assert.ok(ids.includes(expected), `missing report for ${expected}`);
}

for (const report of reports) {
  assert.ok(report.label.length > 0, `${report.id}: needs a label`);
  assert.ok(report.consequence.length > 0, `${report.id}: needs a stated consequence`);
  assert.ok(report.detail.length > 0, `${report.id}: needs detail text`);
  // A ready dependency must never also advertise an install.
  if (report.status === 'ready') {
    assert.equal(report.installable, false, `${report.id}: a ready dependency must not be installable`);
  }
  // An uninstallable report must explain what the user does instead.
  if (!report.installable && report.status !== 'ready') {
    assert.ok(report.note, `${report.id}: uninstallable but gives the user no next step`);
  }
}

// whisper-model used to have no server installer, which forced users through
// Settings before the agent could transcribe anything — and an agent that
// cannot transcribe cannot add subtitles. It is now installed in-process from
// the catalog-pinned GGML weights (R2 first, then the HF mirrors), so the id is
// installable and the report must advertise it.
//
// What must NOT change: the install is bounded by a pinned SHA-256, so a bad
// download fails rather than being installed. This asserts the shaped-failure
// contract (never a throw) rather than the outcome, because the outcome depends
// on network access that a verifier should not require.
{
  const result = await installDependency('whisper-model');
  assert.equal(typeof result.ok, 'boolean', 'install must always resolve with a shaped result');
  if (!result.ok) assert.ok(result.error, 'a failed install must explain itself');
}

// The id check is the security boundary: only registry keys pass.
assert.equal(isDependencyId('ffmpeg'), true);
assert.equal(isDependencyId('whisper-cli'), true);
assert.equal(isDependencyId('mediapipe'), true);
assert.equal(isDependencyId('rm -rf /'), false);
assert.equal(isDependencyId('; echo pwned'), false);
assert.equal(isDependencyId('__proto__'), false, 'prototype keys must not be treated as ids');
assert.equal(isDependencyId(undefined), false);
assert.equal(isDependencyId(42), false);

// canInstall must agree with what installDependency will actually attempt, and
// no report may advertise an install for an id that has no installer — that
// renders a button which can only ever fail.
assert.equal(canInstall('whisper-cli'), true);
assert.equal(canInstall('mediapipe'), true);
assert.equal(canInstall('whisper-model'), true,
  'the agent must be able to provision transcription weights itself');
assert.equal(canInstall('ffmpeg'), false, 'ffmpeg ships as a dependency; there is nothing to download');
// The music packs download in-process through the pinned model-pack manager.
assert.equal(canInstall('rhythm-pack'), true, 'the rhythm pack must be installable from the dependency endpoint');
assert.equal(canInstall('music-semantics-pack'), true, 'the music embedding pack must be installable');

for (const report of reports) {
  assert.equal(
    report.installable,
    canInstall(report.id as Parameters<typeof canInstall>[0]) && report.status !== 'ready',
    `${report.id}: installable must match the registry and current status`,
  );
}

// Inherited object keys must never be accepted as dependency ids.
for (const hostile of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
  assert.equal(isDependencyId(hostile), false, `${hostile} must not be an id`);
}

console.log('dependencies: registry, reporting and install gating verified');
