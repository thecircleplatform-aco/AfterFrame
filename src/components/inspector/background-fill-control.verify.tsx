import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { BackgroundFillControlView } from './BackgroundFillControl';
import { resolveBackgroundFillToggle } from './backgroundFillControlState';

const markup = renderToStaticMarkup(
  <BackgroundFillControlView
    enabled
    strength={75}
    translate={(key) => key}
    onChange={() => undefined}
    onApplyToAll={() => undefined}
  />,
);

assert.match(markup, /aria-label="\u80cc\u666f\u586b\u5145\u5f3a\u5ea6"[^>]*type="range"[^>]*value="75"/);
assert.match(markup, /aria-label="\u80cc\u666f\u586b\u5145\u5f3a\u5ea6"/);
assert.equal((markup.match(/role="radio"/g) ?? []).length, 4, 'four percentage shortcuts stay visible');
assert.match(markup, />\u5f3a\u70c8 75%<\/small>/, 'quick shortcuts expose their exact percentages');
assert.match(markup, /aria-checked="true"[^>]*class="selected"/);
assert.match(markup, />\u5168\u90e8\u5e94\u7528<\/button>/);
assert.match(markup, /\u7528\u7247\u6bb5\u526f\u672c\u586b\u6ee1\u753b\u5e03\u7a7a\u767d/);

const disabled = renderToStaticMarkup(
  <BackgroundFillControlView enabled={false} strength={50} translate={(key) => key}
    onChange={() => undefined} />,
);
assert.doesNotMatch(disabled, /aria-label="\u80cc\u666f\u586b\u5145\u5f3a\u5ea6"/, 'disabled fills keep the strength controls collapsed');

for (const enabled of [false, true]) {
  const mixed = renderToStaticMarkup(
    <BackgroundFillControlView enabled={enabled} mixed strength={83} strengthMixed
      translate={(key) => key} onChange={() => undefined} onApplyToAll={() => undefined} />,
  );
  assert.match(mixed, /class="cc-bg-fill-apply" disabled=""/,
    'mixed percentages cannot be silently applied from the primary item');
  assert.doesNotMatch(mixed, /aria-checked="true"/,
    'mixed percentages do not present the primary item as the shared value');
}

assert.deepEqual(resolveBackgroundFillToggle(true, false, 100, true), { enabled: true },
  'mixed percentages enable all without copying a disabled primary item value');
assert.deepEqual(resolveBackgroundFillToggle(true, true, 25, true), { enabled: true },
  'mixed percentages enable all without copying an enabled primary item value');
assert.deepEqual(resolveBackgroundFillToggle(true, false, 73, false),
  { enabled: true, strength: 73 }, 'a shared percentage is retained while enabling mixed states');
assert.deepEqual(resolveBackgroundFillToggle(false, false, 50, false), { enabled: false },
  'a settled enabled selection can still be disabled');

console.log('background-fill-control.verify: percentage slider, shortcuts, mixed state, and apply-all controls ok');
