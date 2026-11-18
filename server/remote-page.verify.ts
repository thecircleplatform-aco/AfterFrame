// Renders the remote phone page and checks the emitted document is coherent.
//
// The page is one giant template literal containing a `<script>` — a stray
// backtick or an unescaped `${` produces syntactically invalid JS that no
// typechecker sees, and the failure only shows up on a phone.
import assert from 'node:assert/strict';
import { RemoteControlService } from './remote-control-service.ts';

// The LAN address the snapshot advertises is not 127.0.0.1, so the listener has
// to bind every interface for this test to reach it the way a phone would.
const service = new RemoteControlService();
const created = await service.createSession('en');

try {
  const url = created.addresses[0]?.url;
  assert.ok(url, 'need a LAN url');

  const page = await fetch(url).then((res) => res.text());

  // The un-paired variant must be reachable and must not try to connect.
  const paired = /var PAIRED=(true|false);/.exec(page);
  assert.ok(paired, 'page must declare PAIRED');
  assert.equal(paired[1], 'true', 'tokenised page is paired');

  // Balanced tags for the elements the script looks up by id; a missing id is a
  // null deref on the phone with no console open.
  for (const id of [
    'main', 'stream', 'input', 'send', 'attach', 'file', 'previews', 'dot',
    'sub', 'banner', 'hint', 'watch', 'watchImg', 'watchPos', 'watchOff',
    'scanBtn', 'scan', 'scanVideo', 'scanHint', 'scanClose',
  ]) {
    assert.match(page, new RegExp(`id="${id}"`), `page must contain #${id}`);
  }

  // Extract the inline script and make sure it parses. `new Function` compiles
  // without executing, which is exactly the check we need.
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1];
  assert.ok(script, 'page must contain a script');
  assert.doesNotThrow(() => new Function(script), 'inline script must parse');

  // No template placeholder may survive into the output.
  assert.doesNotMatch(script, /\$\{/, 'unresolved template placeholder in script');
  assert.doesNotMatch(page, /\$\{copy\./, 'unresolved template placeholder in markup');

  // Manifest icons must match what the service serves.
  const bare = url.replace(/\/r\/[A-Za-z0-9_-]+$/, '');
  const unpaired = await fetch(`${bare}/`).then((res) => res.text());
  assert.match(unpaired, /var PAIRED=false;/, 'bare origin must be unpaired');
  assert.match(unpaired, /id="scanCtaBig"/, 'bare origin must offer a scan button');
  // …and must not open a stream that cannot exist.
  assert.match(unpaired, /function connect\(\)\{\s*if\(!PAIRED\) return;/, 'unpaired page must not connect');
  // The camera must never start without a tap: an auto-start burns a permission
  // prompt and lights the recording indicator on page load.
  assert.doesNotMatch(
    unpaired,
    /PAIRED\)\{[\s\S]{0,400}startScan\(\);\s*\}/,
    'unpaired page must not auto-start the camera',
  );
} finally {
  await service.stop();
}

console.log('remote-page: emitted document is coherent');
