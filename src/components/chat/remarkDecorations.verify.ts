// Verifies the chat text-decoration plugin.
//
// Three things must hold and each is easy to break silently:
//   1. The transform emits ONLY ordinary mdast nodes — never raw HTML. The chat
//      renders untrusted model output with no rehype plugins and no sanitizer,
//      so anything that reintroduces HTML is an XSS path, not a formatting bug.
//   2. Partial output must not disappear. Messages re-render on every streamed
//      token, so "==highl" (opener typed, closer not yet) has to render as plain
//      text instead of being swallowed.
//   3. Normal markdown must survive untouched — bold/italic/code containing
//      decoration characters must not be mis-parsed.
import assert from 'node:assert/strict';
import type { Root, RootContent } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkDecorations, CALLOUT_TONES } from './remarkDecorations';

/** Parse real markdown, then run the plugin — exactly what react-markdown does. */
function parseAndDecorate(markdown: string): Root {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  (remarkDecorations as unknown as () => (t: Root) => void)()(tree);
  return tree;
}

/** Plugin run on a hand-built tree, for inline-only cases. */
function run(children: RootContent[]): Root {
  const tree: Root = { type: 'root', children };
  const transformer = (remarkDecorations as unknown as () => (t: Root) => void)();
  transformer(tree);
  return tree;
}

function para(...nodes: RootContent[]): RootContent {
  return { type: 'paragraph', children: nodes } as RootContent;
}

/** Every hName the transform can introduce. Anything else is a leak. */
const ALLOWED_HNAMES = new Set(['mark', 'kbd', 'em', 'strong']);

function collectHNames(tree: Root): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { data?: { hName?: string }; children?: unknown[] };
    if (n.data?.hName) found.push(n.data.hName);
    n.children?.forEach(walk);
  };
  walk(tree);
  return found;
}

// ── 1. Inline decorations become real, classed elements ────────────────────
{
  const tree = run([para({ type: 'text', value: 'Speed is ==critical== here.' })]);
  const hNames = collectHNames(tree);
  assert.deepEqual(hNames, ['mark'], 'highlight becomes a <mark>');

  // `Speed is ` stays a plain text node, so the mark is the second child.
  const children = (tree.children[0] as {
    children: { type: string; data?: { hProperties?: { className?: string[] } }; children?: { value: string }[] }[];
  }).children;
  const mark = children.find((child) => child.type === 'emphasis');
  assert.deepEqual(mark?.data?.hProperties?.className, ['cc-md-highlight']);
  assert.equal(mark?.children?.[0]?.value, 'critical', 'the delimiters are stripped from the content');
  assert.equal(children[0]?.type, 'text');
  assert.equal(children[children.length - 1]?.type, 'text', 'trailing text is preserved');
}

// ── 2. Every inline kind maps to a distinct class ─────────────────────────
{
  const cases: [string, string][] = [
    ['!!broken!!', 'cc-md-important'],
    ['??unsure??', 'cc-md-caution'],
    ['++verified++', 'cc-md-success'],
    ['::V1::', 'cc-md-badge'],
    ['[[Ctrl+S]]', 'cc-md-kbd'],
  ];
  for (const [source, expected] of cases) {
    const tree = run([para({ type: 'text', value: `x ${source} y` })]);
    const decorated = (tree.children[0] as unknown as { children: Record<string, unknown>[] }).children
      .find((c) => (c.data as { hProperties?: { className?: string[] } })?.hProperties?.className?.length);
    const cls = (decorated?.data as { hProperties?: { className?: string[] } })?.hProperties?.className?.[0];
    assert.equal(cls, expected, `${source} → ${expected}`);
  }
}

// ── 3. Never emits anything outside the whitelist (no raw HTML) ───────────
{
  const tree = run([para({
    type: 'text',
    value: '==h== !!i!! ??c?? ++s++ ::b:: [[Ctrl+Z]] >>> tip hello <script>alert(1)</script>',
  })]);
  for (const name of collectHNames(tree)) {
    assert.ok(ALLOWED_HNAMES.has(name), `unexpected element <${name}> introduced by decorations`);
  }
  // The plugin must not emit an `html` node type from text that looked like markup.
  const types: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; children?: unknown[] };
    if (n.type) types.push(n.type);
    n.children?.forEach(walk);
  };
  walk(tree);
  assert.ok(!types.includes('html'), 'decorations must never produce an html node');
}

// ── 4. Partial (streaming) input degrades to plain text ───────────────────
{
  for (const partial of ['==highl', 'before ==str', '==', '!!dan', '::bad']) {
    const tree = run([para({ type: 'text', value: partial })]);
    assert.deepEqual(collectHNames(tree), [],
      `"${partial}" is an unterminated opener and must render as plain text`);
    const text = (tree.children[0] as { children: { value?: string }[] }).children
      .map((c) => c.value ?? '').join('');
    assert.equal(text, partial, `"${partial}" must survive verbatim`);
  }
}

// ── 5. Existing markdown is not mis-parsed ────────────────────────────────
{
  // Inline code is literal: `a == b` inside backticks must stay untouched.
  const codeTree = run([para({ type: 'inlineCode', value: 'a == b == c' })]);
  assert.deepEqual(collectHNames(codeTree), [], 'decoration markers inside inline code are literal');

  // An emphasis node's children are still processed, but the delimiters that
  // belong to markdown itself are not part of the text node.
  const boldTree = run([para({ type: 'text', value: '**bold** and ==marked==' })]);
  assert.deepEqual(collectHNames(boldTree), ['mark'],
    'plain bold text is not turned into a decoration');
}

// ── 6. Callouts collapse the nested `>>>` quote into one toned block ──────
// CommonMark parses `>>>` as THREE nested blockquotes, so this must be tested
// through the real parser — a hand-built paragraph would pass while the actual
// chat still showed three stacked quote bars.
{
  const tree = parseAndDecorate('>>> warning This deletes the clip.');
  assert.equal(tree.children.length, 1, 'the three quote levels collapse to one node');
  const block = tree.children[0] as {
    type: string;
    data?: { hProperties?: { className?: string[] } };
    children: { children: { children?: { value?: string }[] }[] }[];
  };
  assert.equal(block.type, 'blockquote');
  assert.deepEqual(block.data?.hProperties?.className, ['cc-md-callout', 'cc-md-callout-warning']);
  const text = JSON.stringify(block.children);
  assert.ok(!text.includes('>>>'), 'the marker is gone');
  assert.ok(text.includes('This deletes the clip.'), 'the body text survives');
  assert.ok(!text.includes('warning This'), 'the tone word is stripped from the body');
}

// ── 7. Tone parsing: default, case, and unknown tone ─────────────────────
{
  const cls = (md: string) => (parseAndDecorate(md).children[0] as {
    data?: { hProperties?: { className?: string[] } };
  }).data?.hProperties?.className;

  assert.deepEqual(cls('>>> just a note'), ['cc-md-callout', 'cc-md-callout-note'],
    'a bare >>> defaults to note');
  assert.deepEqual(cls('>>> TIP Use hard cuts.'), ['cc-md-callout', 'cc-md-callout-tip'],
    'tone matching is case-insensitive');
  // An unknown tone is not a tone at all — it becomes body text, and the callout
  // falls back to the neutral `note` style. That is better than inventing a
  // colour class, and it means a typo ("warnign Delete it") still shows the text.
  const unknownTree = parseAndDecorate('>>> bogus hello');
  assert.deepEqual(cls('>>> bogus hello'), ['cc-md-callout', 'cc-md-callout-note'],
    'an unknown tone falls back to note');
  assert.ok(JSON.stringify(unknownTree.children).includes('bogus hello'),
    'an unrecognised tone is kept as body text rather than dropped');

  // Two levels is a real nested quote and must be left alone.
  const nested = parseAndDecorate('>> a genuine nested quote');
  assert.equal((nested.children[0] as { data?: unknown }).data, undefined,
    '>> is a real nested blockquote, not a callout');
}

// ── 8. A normal paragraph is left completely alone ───────────────────────
{
  const plain = 'Just a normal sentence with no markers.';
  const tree = parseAndDecorate(plain);
  assert.deepEqual(collectHNames(tree), []);
  const first = (tree.children[0] as { children: { value?: string }[] }).children[0]!;
  assert.equal(first.value, plain);
}

// ── 9. Tone list stays in sync with the schema regex ─────────────────────
assert.match(CALLOUT_TONES, /tip/, 'CALLOUT_TONES is exported for the prompt/docs');

console.log('remarkDecorations.verify: inline decorations, callouts, streaming-safety and no-HTML all hold');
