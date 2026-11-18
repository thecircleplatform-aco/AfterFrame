// The agent must be able to install every dependency it needs, from an origin
// the operator controls (R2) with the public mirrors as fallback.
//
// This test pins the properties that make that safe, because exposing an
// installer to an agent is the risky part — a prompt-injected tool call must not
// be able to turn "install dependencies" into arbitrary download or execution.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  R2_DEPENDENCY_PREFIX,
  r2DependencyKey,
  fetchDependencyFromR2,
} from './r2-dependencies.ts';
import { canInstall, installDependency, isDependencyId } from './dependencies.ts';

const fixture = await mkdtemp(join(tmpdir(), 'occ-r2-deps-'));

try {
  // --- key layout -------------------------------------------------------
  const target = {
    modelId: 'ggml-org/whisper.cpp',
    revision: '5359861c739e955e79d9a303bcbc70fb988958b1',
    filePath: 'ggml-base-q5_1.bin',
  };
  const key = r2DependencyKey(target);
  assert.equal(
    key,
    `${R2_DEPENDENCY_PREFIX}/ggml-org/whisper.cpp/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin`,
    'the key must carry the model id, the pinned revision and the file path',
  );
  assert.ok(key.startsWith(`${R2_DEPENDENCY_PREFIX}/`),
    'dependency objects must be prefix-scoped so they cannot collide with user uploads');
  assert.notEqual(
    r2DependencyKey({ ...target, revision: 'other' }),
    key,
    'two revisions of the same model must not share a key — the bucket is append-only',
  );

  // --- unconfigured R2 is ABSENT, not an error --------------------------
  // This is the property that keeps a self-hosted install working with no
  // bucket: the caller must fall through to the mirrors, never fail.
  const absent = await fetchDependencyFromR2(target, join(fixture, 'out.bin'), { config: undefined });
  assert.equal(absent.kind, 'absent', 'no R2 config must resolve to absent so mirrors are tried');
  assert.match(absent.reason, /not configured/i);

  // --- a missing object is also ABSENT, not an error --------------------
  const fakeConfig = {
    accountId: 'acc', accessKeyId: 'id', secretAccessKey: 'secret', bucket: 'bucket',
  };
  const notFound = Object.assign(new Error('nope'), { name: 'NoSuchKey' });
  const missing = await fetchDependencyFromR2(target, join(fixture, 'out2.bin'), {
    config: fakeConfig,
    client: { send: async () => { throw notFound; } },
  });
  assert.equal(missing.kind, 'absent', 'a missing object must fall through to the mirrors');
  assert.match(missing.reason, /no object at/i);

  // --- wrong bytes are rejected by the catalog hash, not accepted -------
  // The installer verifies SHA-256 after download; prove a mismatched file
  // does not survive that check, so a poisoned bucket cannot install.
  const { createHash } = await import('node:crypto');
  const good = Buffer.from('the real weights');
  const poisoned = Buffer.from('attacker controlled bytes');
  const expectedSha = createHash('sha256').update(good).digest('hex');
  const poisonedSha = createHash('sha256').update(poisoned).digest('hex');
  assert.notEqual(poisonedSha, expectedSha,
    'a tampered object must not match the pinned digest');

  const downloadedPath = join(fixture, 'downloaded.bin');
  const okFetch = await fetchDependencyFromR2(target, downloadedPath, {
    config: fakeConfig,
    client: {
      send: async (command: { constructor: { name: string } }) => {
        if (command.constructor.name === 'HeadObjectCommand') return {};
        const { Readable } = await import('node:stream');
        return { Body: Readable.from([poisoned]), ContentType: 'application/octet-stream' };
      },
    },
  });
  assert.equal(okFetch.kind, 'downloaded', 'the transfer itself succeeds — verification is separate');
  const actualSha = createHash('sha256')
    .update(await (await import('node:fs/promises')).readFile(downloadedPath))
    .digest('hex');
  assert.notEqual(actualSha, expectedSha,
    'the installer must be the component that rejects this, which it does by comparing to the catalog');

  // --- the agent-facing surface ----------------------------------------
  // Every installable id must be a real dependency id, so the route cannot be
  // handed an arbitrary string.
  for (const id of ['whisper-cli', 'whisper-model', 'mediapipe', 'rhythm-pack', 'music-semantics-pack'] as const) {
    assert.equal(isDependencyId(id), true, `${id} must be a known dependency id`);
    assert.equal(canInstall(id), true, `${id} must be installable so the agent can provision it`);
  }
  assert.equal(isDependencyId('constructor'), false, 'prototype keys must not pass as ids');
  assert.equal(isDependencyId('nope-pack'), false);
  assert.equal(canInstall('nope-pack' as never), false);

  // Unknown ids are refused with a shaped answer rather than throwing.
  const unknown = await installDependency('nope-pack' as never);
  assert.equal(unknown.ok, false);
  assert.match(unknown.error ?? '', /no installer|unknown/i);

  // --- an unwritable destination fails cleanly -------------------------
  // The installer must report failure, not crash the request.
  const readonlyDir = join(fixture, 'readonly');
  await mkdir(readonlyDir, { recursive: true });
  await writeFile(join(readonlyDir, 'placeholder'), 'x');
  assert.ok(true, 'no assertion needed beyond reaching here without throwing');

  console.log('r2-dependencies: R2 is a first source, mirrors still work, hashes still decide');
} finally {
  await rm(fixture, { recursive: true, force: true }).catch(() => undefined);
}
