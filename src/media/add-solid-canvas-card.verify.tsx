import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddSolidCanvasCard } from './AddSolidCanvasCard';

const markup = renderToStaticMarkup(
  <AddSolidCanvasCard label="\u6dfb\u52a0\u7eaf\u8272\u80cc\u666f/\u753b\u5e03" onAdd={() => undefined} />,
);

assert.match(
  markup,
  /class="cc-add-solid-canvas-card"/,
  '\u6211\u7684\u7d20\u6750\u7f51\u683c\u7b2c\u4e00\u683c\u5e94\u63d0\u4f9b\u6dfb\u52a0\u7eaf\u8272\u80cc\u666f/\u753b\u5e03\u5feb\u6377\u5361\u7247',
);
assert.match(markup, />\u6dfb\u52a0\u7eaf\u8272\u80cc\u666f\/\u753b\u5e03</, '\u5feb\u6377\u5361\u7247\u5e94\u663e\u793a\u660e\u786e\u64cd\u4f5c\u540d\u79f0');
assert.match(markup, /aria-label="\u6dfb\u52a0\u7eaf\u8272\u80cc\u666f\/\u753b\u5e03"/, '\u6574\u5f20\u5361\u7247\u5e94\u662f\u53ef\u8bbf\u95ee\u7684\u6dfb\u52a0\u64cd\u4f5c');

console.log('add-solid-canvas-card.verify: first-grid action card OK');
