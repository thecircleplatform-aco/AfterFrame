// R2 as the FIRST download source for app dependencies (model packs, weights).
//
// Why: every model download currently races public mirrors (ModelScope, Hugging
// Face, two CDNs). Those are fine until they are slow, rate-limited, blocked by
// a network, or the exact revision disappears. An R2 bucket the operator owns
// gives one fast, versioned origin the app controls — and because every file is
// already pinned by SHA-256 in the catalog, R2 needs no extra trust: a wrong or
// corrupted object simply fails verification and the next source is tried.
//
// Design constraints, learned from the existing proxy:
//   - It is a SOURCE, not a replacement. If R2 is unconfigured or the object is
//     absent, the caller falls through to the mirrors. Dependency installs must
//     never break because a bucket was not set up.
//   - Objects are addressed by the SAME (modelId, revision, filePath) triple the
//     catalog uses, so one bucket can mirror the whole catalog without a second
//     naming scheme to keep in sync.
//   - The key layout is prefix-scoped (`dependency-models/<modelId>/<revision>/
//     <filePath>`) so a bucket that also holds user uploads cannot collide with
//     them, and so the operator can set a lifecycle rule on models alone.
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { r2Config, type R2Config } from './r2.ts';

/** Key prefix that holds downloadable app dependencies in the bucket. */
export const R2_DEPENDENCY_PREFIX = 'dependency-models';

export interface R2DependencyTarget {
  readonly modelId: string;
  readonly revision: string;
  readonly filePath: string;
}

/**
 * Object key for a catalog file.
 *
 * `revision` is included so an immutable HF commit is never overwritten: two
 * revisions of the same model coexist in the bucket and the catalog decides
 * which one is current. That also makes the bucket safe to cache forever.
 */
export function r2DependencyKey(target: R2DependencyTarget, prefix = R2_DEPENDENCY_PREFIX): string {
  // Model ids contain '/'; keep it, it maps to a natural directory tree.
  return `${prefix}/${target.modelId}/${target.revision}/${target.filePath}`;
}

export function r2DependencyUrl(target: R2DependencyTarget): string | null {
  const cfg = r2Config();
  if (!cfg) return null;
  return `r2://${cfg.bucket}/${r2DependencyKey(target)}`;
}

/** Whether an R2-backed dependency source is configured at all. */
export function r2DependencySourceAvailable(): boolean {
  return r2Config() !== null;
}

export type R2DependencyFetchOutcome =
  | { readonly kind: 'downloaded'; readonly bytes: number }
  /** Not configured, or no such object. The caller must fall through to mirrors. */
  | { readonly kind: 'absent'; readonly reason: string }
  | { readonly kind: 'failed'; readonly error: string };

interface FetchDependencies {
  readonly config?: R2Config;
  readonly client?: Pick<S3Client, 'send'>;
  readonly signal?: AbortSignal;
  readonly prefix?: string;
}

function clientForDependency(cfg: R2Config, injected?: Pick<S3Client, 'send'>): Pick<S3Client, 'send'> {
  if (injected) return injected;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: true,
  });
}

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as { name?: string }).name ?? '';
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

/**
 * Download one dependency file from R2 to `destinationPath`.
 *
 * Streams to `.part` and only renames on a clean finish, so an interrupted
 * download can never be mistaken for a complete file. Integrity is deliberately
 * NOT checked here: the model-pack installer verifies SHA-256 against the pinned
 * catalog immediately after, and duplicating that rule in two places is how the
 * two drift apart.
 */
export async function fetchDependencyFromR2(
  target: R2DependencyTarget,
  destinationPath: string,
  dependencies: FetchDependencies = {},
): Promise<R2DependencyFetchOutcome> {
  const cfg = dependencies.config ?? r2Config();
  if (!cfg) return { kind: 'absent', reason: 'R2 is not configured' };
  const key = r2DependencyKey(target, dependencies.prefix);
  const client = clientForDependency(cfg, dependencies.client);

  // HEAD first: a missing object must fall through cheaply without opening a
  // stream, and it lets us reject an obviously wrong size before writing.
  try {
    await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }), {
      abortSignal: dependencies.signal,
    });
  } catch (error) {
    if (isNotFound(error)) return { kind: 'absent', reason: `no object at ${key}` };
    return { kind: 'failed', error: `R2 head failed for ${key}: ${String(error)}` };
  }

  const partial = `${destinationPath}.part`;
  await mkdir(dirname(destinationPath), { recursive: true });
  await rm(partial, { force: true }).catch(() => undefined);

  let written = 0;
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
      { abortSignal: dependencies.signal },
    );
    const body = response.Body;
    if (!body) return { kind: 'failed', error: `R2 returned an empty body for ${key}` };
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        written += chunk.length;
        done(null, chunk);
      },
    });
    await pipeline(
      body as Readable,
      counter,
      createWriteStream(partial),
      { signal: dependencies.signal },
    );
    const size = (await stat(partial)).size;
    if (size === 0) {
      await rm(partial, { force: true }).catch(() => undefined);
      return { kind: 'failed', error: `R2 object ${key} was empty` };
    }
    const { rename } = await import('node:fs/promises');
    await rename(partial, destinationPath);
    return { kind: 'downloaded', bytes: size };
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    return { kind: 'failed', error: `R2 download failed for ${key}: ${String(error)}` };
  }
}
