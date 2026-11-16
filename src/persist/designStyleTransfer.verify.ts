import assert from 'node:assert/strict';
import type { DesignStyle } from '../editor/types';
import { buildDesignStyleRecipe, parseDesignStyleRecipe } from './designStyleTransfer';

const style: DesignStyle = {
  colors: [{ role: ' accent ', value: ' #ff5500 ' }],
  fonts: [{ role: 'heading', family: ' Inter ' }],
  styleGuide: '  \u5feb\u8282\u594f，\u907f\u514d\u95ea\u767d\u8f6c\u573a\u3002  ',
};
const built = buildDesignStyleRecipe('  \u793e\u4ea4\u77ed\u7247  ', style, {
  scenarios: [' social ', 'social', 'launch'],
});
const parsed = parseDesignStyleRecipe(JSON.stringify(built));

assert.equal(parsed.name, '\u793e\u4ea4\u77ed\u7247');
assert.deepEqual(parsed.scenarios, ['social', 'launch']);
assert.deepEqual(parsed.style.colors, [{ role: 'accent', value: '#ff5500' }]);
assert.equal(parsed.style.fonts[0]?.family, 'Inter');
assert.equal(parsed.style.styleGuide, '\u5feb\u8282\u594f，\u907f\u514d\u95ea\u767d\u8f6c\u573a\u3002');

assert.throws(() => parseDesignStyleRecipe('{'), /JSON/);
assert.throws(() => parseDesignStyleRecipe(JSON.stringify({ ...built, version: 2 })), /\u7248\u672c/);
assert.throws(() => parseDesignStyleRecipe(JSON.stringify({
  ...built,
  style: { colors: [{ role: 'accent' }], fonts: [] },
})), /\u989c\u8272\u503c/);

console.log('designStyleTransfer.verify: ok');
