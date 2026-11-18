// Verifies the generated PWA icons are real, decodable PNGs.
//
// The remote phone page has no asset pipeline: the service inlines into the
// desktop build, so the icons are synthesised at runtime. A broken encoder
// would silently produce a 200 with garbage bytes and the phone would show a
// blank home-screen icon — invisible until someone installs the app.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { renderIconPng } from './remote-control-service.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Chunk {
  readonly type: string;
  readonly data: Buffer;
}

function chunksOf(png: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('latin1');
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}

for (const size of [192, 512]) {
  const png = renderIconPng(size);

  // Signature: without this nothing else matters.
  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE, `${size}: bad signature`);

  const chunks = chunksOf(png);
  assert.equal(chunks[0]?.type, 'IHDR', `${size}: first chunk must be IHDR`);
  assert.equal(chunks.at(-1)?.type, 'IEND', `${size}: last chunk must be IEND`);

  const ihdr = chunks[0]!.data;
  assert.equal(ihdr.readUInt32BE(0), size, `${size}: width`);
  assert.equal(ihdr.readUInt32BE(4), size, `${size}: height`);
  assert.equal(ihdr[8], 8, `${size}: bit depth`);
  assert.equal(ihdr[9], 6, `${size}: must be RGBA`);

  const idat = chunks.find((chunk) => chunk.type === 'IDAT');
  assert.ok(idat, `${size}: missing IDAT`);

  // The pixels must inflate back to exactly one filter byte + RGBA per row.
  const raw = inflateSync(idat.data);
  assert.equal(raw.length, size * (size * 4 + 1), `${size}: raw scanline length`);

  // Centre pixel is the white triangle; a corner must be transparent or black.
  const centre = Math.floor(size / 2) * (size * 4 + 1) + 1 + Math.floor(size / 2) * 4;
  const centrePixel = [...raw.subarray(centre, centre + 3)];
  assert.ok(centrePixel.every((channel) => channel > 200), `${size}: centre should be white, got ${centrePixel}`);

  const corner = 0 * (size * 4 + 1) + 1 + 0;
  assert.equal(raw[corner + 3], 0, `${size}: corner should be transparent`);
}

console.log('remote-icon: icons encode correctly');
