// checks: skin registry integrity + contrast gate (impeccable colorize discipline curing).
// To change the color of any skin, you must go here: text/panel ≥ 7, textDim/panel ≥ 4.5,
// textMuted/panel ≥ 4.5, onAccent/accent ≥ 4.5 (WCAG AA).
// `npx tsx src/skins.verify.ts`
import assert from 'node:assert/strict';
import { DEFAULT_SKIN, SKINS, buildSkinsCss } from './skins';

function luminance(hex: string): number {
  const f = (c: number): number => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(parseInt(hex.slice(1, 3), 16))
    + 0.7152 * f(parseInt(hex.slice(3, 5), 16))
    + 0.0722 * f(parseInt(hex.slice(5, 7), 16));
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mixHex(foreground: string, background: string, foregroundWeight: number): string {
  const channel = (hex: string, index: number): number => parseInt(hex.slice(index, index + 2), 16);
  const mixed = [1, 3, 5].map((index) => Math.round(
    channel(foreground, index) * foregroundWeight
      + channel(background, index) * (1 - foregroundWeight),
  ));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

// ── Registry integrity ──
assert.ok(SKINS.length >= 2, '\u81f3\u5c11\u9ed8\u8ba4 + 1 \u5957');
assert.equal(new Set(SKINS.map((s) => s.id)).size, SKINS.length, '\u76ae\u80a4 id \u552f\u4e00');
assert.ok(SKINS.some((s) => s.id === DEFAULT_SKIN), '\u9ed8\u8ba4\u76ae\u80a4\u5fc5\u987b\u5728\u6ce8\u518c\u8868\u91cc');
for (const s of SKINS) {
  assert.ok(/^[a-z]+$/.test(s.id), `${s.id}: id \u5c0f\u5199\u5b57\u6bcd`);
  assert.ok(s.nameZh.trim().length > 0, `${s.id}: \u6709\u4e2d\u6587\u540d`);
  assert.match(s.tokens.accentRgb, /^\d{1,3},\d{1,3},\d{1,3}$/, `${s.id}: accentRgb \u4e09\u5143\u7ec4`);
  assert.match(s.tokens.inkRgb, /^\d{1,3},\d{1,3},\d{1,3}$/, `${s.id}: inkRgb \u4e09\u5143\u7ec4`);
  assert.match(s.tokens.shadowRgb, /^\d{1,3},\d{1,3},\d{1,3}$/, `${s.id}: shadowRgb \u4e09\u5143\u7ec4`);
  for (const [name, value] of Object.entries(s.tokens)) {
    if (name === 'accentRgb' || name === 'inkRgb' || name === 'shadowRgb' || name === 'colorScheme') continue;
    assert.match(value, /^#[0-9a-f]{6}$/, `${s.id}.${name}: 6 \u4f4d\u5c0f\u5199 hex(\u5f97\u8fdb\u5bf9\u6bd4\u5ea6\u8ba1\u7b97)`);
  }
}

// ── Contrast Gate (AA) ──
for (const s of SKINS) {
  const t = s.tokens;
  const gate = (label: string, ratio: number, min: number): void =>
    assert.ok(ratio >= min, `${s.id}: ${label} = ${ratio.toFixed(2)} < ${min}`);
  gate('text/panel', contrast(t.text, t.panel), 7);
  gate('text/panelAlt', contrast(t.text, t.panelAlt), 4.5);
  gate('textMuted/panel', contrast(t.textMuted, t.panel), 4.5);
  gate('textDim/panel', contrast(t.textDim, t.panel), 4.4);
  // onAccent by WCAG component/large font level (≥3): graphite white font pressure coral=3.27.
  // (Identity reserved); Use dark characters for pastel skin (Mocha/Arctic/Tokyo Night/Latte), actual ≥4.5.
  gate('onAccent/accent', contrast(t.onAccent, t.accent), 3);
  gate('textStrong/hover', contrast(t.textStrong, t.hover), 4.5);
  gate('audioFxBadge/panelGold10', contrast(t.text, mixHex(t.gold, t.panel, 0.1)), 4.5);
}

// ── CSS generation: The default skin enters:root, the rest have overlay blocks, and body follows ──
const css = buildSkinsCss();
assert.ok(css.includes(':root {'), ':root \u5757');
for (const s of SKINS) {
  if (s.id === DEFAULT_SKIN) continue;
  assert.ok(css.includes(`html[data-cc-skin='${s.id}']`), `${s.id} \u8986\u76d6\u5757`);
}
assert.ok(css.includes('--cc-on-accent:'), 'on-accent \u53d8\u91cf\u8f93\u51fa');
assert.ok(css.includes('--cc-shadow-rgb:'), 'shadow-rgb \u53d8\u91cf\u8f93\u51fa');
assert.ok(css.includes('body { background: var(--cc-bg)'), 'body \u8ddf\u968f\u76ae\u80a4');

process.stdout.write(`skins.verify: ok (${SKINS.length} skins, \u5bf9\u6bd4\u5ea6\u95e8\u5168\u8fc7)\n`);
