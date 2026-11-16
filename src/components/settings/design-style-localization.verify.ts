import assert from 'node:assert/strict';
import { DESIGN_STYLE_PRESETS } from '../../editor/design-presets';
import {
  localizeDesignFontRole,
  localizeDesignPresetName,
  localizeDesignRole,
  localizeDesignStyleGuide,
} from './designStyleLocalization';

const modern = DESIGN_STYLE_PRESETS.find((preset) => preset.name === 'Modern Editorial');
assert.ok(modern, '\u6d4b\u8bd5\u6570\u636e\u5e94\u5305\u542b Modern Editorial');

assert.equal(localizeDesignPresetName(modern.name, 'zh'), '\u73b0\u4ee3\u6742\u5fd7\u7f16\u8f91\u98ce');
assert.equal(localizeDesignPresetName(modern.name, 'en'), modern.name);
assert.equal(localizeDesignRole('background-chart', 'zh'), '\u56fe\u8868\u80cc\u666f');
assert.equal(localizeDesignRole('chart-warm-mid', 'zh'), '\u56fe\u8868\u6696\u8272\u4e2d\u95f4\u8c03');
assert.equal(localizeDesignRole('background-chart', 'en'), 'background-chart');
assert.equal(localizeDesignFontRole('accent', 'zh'), '\u5f3a\u8c03\u5b57\u4f53');
assert.equal(localizeDesignFontRole('callout', 'zh'), '\u6807\u6ce8\u5b57\u4f53');
assert.equal(localizeDesignFontRole('impact', 'zh'), '\u51b2\u51fb\u5b57\u4f53');
assert.equal(localizeDesignFontRole('accent', 'en'), 'accent');
assert.equal(
  localizeDesignStyleGuide(modern.style.styleGuide ?? '', 'zh'),
  '\u73b0\u4ee3\u6742\u5fd7\u7f16\u8f91\u98ce：\u6696\u7070\u7eb8\u5f20\u3001\u7b14\u8bb0\u672c\u6216\u62a5\u520a\u7f51\u683c\u3001\u886c\u7ebf\u6807\u9898\u4e0e\u6e05\u6670\u7684 Roboto \u6b63\u6587\u3002\u6574\u4f53\u50cf\u6570\u636e\u8bb0\u8005\u7684\u6279\u6ce8\u7b14\u8bb0，\u4ee5\u9ed1\u7070\u4e3a\u4e3b，\u4ec5\u7528\u6a59\u8272\u6216\u9ec4\u8272\u5f3a\u8c03\u5173\u952e\u6570\u503c\u548c\u8bed\u53e5\u3002',
);
assert.equal(localizeDesignStyleGuide(modern.style.styleGuide ?? '', 'en'), modern.style.styleGuide);

for (const preset of DESIGN_STYLE_PRESETS) {
  assert.notEqual(localizeDesignPresetName(preset.name, 'zh'), preset.name, `${preset.name} \u5e94\u63d0\u4f9b\u4e2d\u6587\u540d\u79f0`);
  assert.notEqual(
    localizeDesignStyleGuide(preset.style.styleGuide ?? '', 'zh'),
    preset.style.styleGuide,
    `${preset.name} \u5e94\u63d0\u4f9b\u4e2d\u6587\u54c1\u724c\u6307\u5f15`,
  );
}

console.log('design-style-localization.verify: preset names, roles and guides localize to Chinese');
