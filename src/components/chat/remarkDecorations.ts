// Text decorations for assistant replies.
//
// Why a custom remark plugin instead of remark-directive / rehype-raw:
//
// 1. SAFETY. The chat renders untrusted model output and deliberately installs
//    NO rehype plugins, so raw HTML is stripped. Adding `rehype-raw` to get
//    <mark> would require bringing in a sanitizer at the same time, and any gap
//    in that schema is XSS in the main chat surface. This plugin never emits raw
//    HTML: it rewrites the mdast into ordinary nodes (blockquote, heading,
//    emphasis, strong, inlineCode) that react-markdown already renders and
//    sanitizes. Nothing new can become executable.
//
// 2. BUNDLE. remark-directive pulls a parser extension plus micromark
//    machinery; this is ~150 lines with no dependency.
//
// 3. PERF. The message re-parses on every streamed token, so the transform has
//    to be a single linear pass. It scans each text node once and bails out
//    immediately when the line contains no decoration marker.
//
// Syntax (kept ASCII-only and unlikely to collide with real prose):
//   ==highlight==        → mark-style highlight
//   !!important!!        → attention (red)
//   ??unknown??          → caution / warning (amber)  — reads as "we're unsure"
//   ++good++             → success (green)
//   ~~struck~~           → already GFM strikethrough
//   ::label::            → small pill/badge
//   `key` / [[Ctrl+S]]   → keyboard key (kbd)
//   >>> note             → callout block; first word picks the tone
//
// Callout block form (one line, at the start of a line):
//   >>> tip Prefer hard cuts for pace.
//   >>> warning This deletes the original clip.
// Tones: tip | note | warning | info | success | danger. An unknown tone is
// treated as `note` so a typo degrades to a plain callout instead of vanishing.
import type { Plugin } from 'unified';
import type { Root, RootContent, PhrasingContent, Blockquote } from 'mdast';

/** Decoration kinds the renderer knows how to style. */
export type DecorationKind = 'highlight' | 'important' | 'caution' | 'success' | 'badge' | 'key';

export interface CalloutTone { tone: string }

const INLINE_MARKS: { open: string; close: string; kind: DecorationKind }[] = [
  { open: '==', close: '==', kind: 'highlight' },
  { open: '!!', close: '!!', kind: 'important' },
  { open: '??', close: '??', kind: 'caution' },
  { open: '++', close: '++', kind: 'success' },
  { open: '::', close: '::', kind: 'badge' },
];

export const CALLOUT_TONES = 'tip|note|info|warning|success|danger';

/**
 * Matches the first word of a collapsed `>>>` quote: an optional known tone,
 * then the body. The literal `>>>` is NOT part of this text — CommonMark already
 * consumed it as blockquote markers — so this must not anchor on it.
 */
const CALLOUT_LINE = new RegExp(`^\\s*(?:(${CALLOUT_TONES})\\b\\s*)?(.*)$`, 'is');

/**
 * Find the closing delimiter for an inline mark, or -1.
 * Requires non-empty content so `====` and `: :` do not match, and rejects a
 * run of the same character (`**bold**` must not be eaten by `==` logic).
 */
function findClose(text: string, open: string, from: number): number {
  const close = open;
  let index = text.indexOf(close, from);
  while (index !== -1) {
    // Content must be non-empty and not start/end with the delimiter char,
    // otherwise `=====` (a rule) or `:::` would be misread as a badge.
    const content = text.slice(from, index);
    if (content.length > 0 && !content.startsWith(close[0]!) && !content.endsWith(close[0]!)) return index;
    index = text.indexOf(close, index + close.length);
  }
  return -1;
}

/** Split one text value into decorated mdast phrasing nodes. */
function decorateText(value: string): PhrasingContent[] | null {
  // Fast path: nothing that could be a decoration. This is the common case for
  // streamed tokens, so it matters more than the parsing below. `[` must be in
  // this class or `[[Ctrl+S]]` shortcuts would be skipped entirely.
  if (!/[=!?+:[<]/.test(value)) return null;

  const out: PhrasingContent[] = [];
  let cursor = 0;
  let sawDecoration = false;

  const pushPlain = (text: string) => {
    if (text) out.push({ type: 'text', value: text });
  };

  while (cursor < value.length) {
    // Keyboard chord: `[[…]]` is unambiguous and contains no delimiter chars.
    // Search the REMAINDER rather than reusing a global regex against the whole
    // string — a global `lastIndex` moves past the cursor and silently skips
    // matches, which is why `x [[Ctrl+S]] y` used to render untouched.
    const kbdAt = value.indexOf('[[', cursor);
    const kbdEnd = kbdAt === -1 ? -1 : value.indexOf(']]', kbdAt + 2);
    const kbdText = kbdAt !== -1 && kbdEnd !== -1 ? value.slice(kbdAt + 2, kbdEnd) : '';
    const kbdOk = kbdText.length > 0 && kbdText.length <= 24 && !kbdText.includes('\n');

    // Inline marks: pick whichever opens earliest at/after the cursor.
    let best: { at: number; open: string; close: string; kind: DecorationKind } | null = null;
    for (const mark of INLINE_MARKS) {
      const at = value.indexOf(mark.open, cursor);
      if (at === -1) continue;
      if (!best || at < best.at) best = { at, ...mark };
    }

    // Whichever comes first wins; if only the chord is present, take it.
    if (kbdOk && (!best || kbdAt <= best.at)) {
      pushPlain(value.slice(cursor, kbdAt));
      out.push({
        type: 'emphasis',
        data: { hName: 'kbd', hProperties: { className: ['cc-md-kbd'] } },
        children: [{ type: 'text', value: kbdText.toUpperCase() }],
      });
      sawDecoration = true;
      cursor = kbdEnd + 2;
      continue;
    }

    if (!best) break;

    const closeAt = findClose(value, best.close, best.at + best.open.length);
    if (closeAt === -1) {
      // Unterminated opener: emit the rest as text. Happens constantly mid-stream
      // (the model has typed `==` but not the closing `==` yet), and bailing out
      // here is what keeps the partial output looking normal instead of vanishing.
      break;
    }

    pushPlain(value.slice(cursor, best.at));
    const inner = value.slice(best.at + best.open.length, closeAt);
    out.push({
      type: 'emphasis',
      data: {
        hName: 'mark',
        hProperties: { className: [`cc-md-${best.kind}`] },
      },
      children: [{ type: 'text', value: inner }],
    });
    sawDecoration = true;
    cursor = closeAt + best.close.length;
  }

  if (!sawDecoration) return null;
  pushPlain(value.slice(cursor));
  return out;
}

/** Recursively rewrite phrasing children of a node. */
function decorateChildren(node: { children?: unknown[] }): void {
  const children = node.children as (PhrasingContent | RootContent)[] | undefined;
  if (!children?.length) return;
  const next: (PhrasingContent | RootContent)[] = [];
  for (const child of children) {
    if (child.type === 'text') {
      const decorated = decorateText(child.value);
      if (decorated) { next.push(...decorated); continue; }
      next.push(child);
      continue;
    }
    // Don't descend into code — a `==` inside a code fence is literal source.
    if (child.type !== 'inlineCode' && child.type !== 'code' && 'children' in child) {
      decorateChildren(child as { children?: unknown[] });
    }
    next.push(child);
  }
  node.children = next;
}

/**
 * Turn `>>> tone text` into a toned callout.
 *
 * IMPORTANT: by the time this plugin runs, CommonMark has ALREADY parsed `>>>`
 * as three nested blockquotes — the literal `>>>` never survives into a text
 * node, so scanning text for it (the obvious approach) silently matches
 * nothing and you get three stacked quote bars instead of a callout. So we
 * recognise the nested-quote SHAPE and collapse it into one blockquote carrying
 * the tone read from the first word of its content.
 */
function collapseCallout(node: Blockquote): { tone: string; body: Blockquote } | null {
  // Walk down while each level holds exactly one blockquote child.
  let depth = 1;
  let current: Blockquote = node;
  while (
    current.children.length === 1
    && current.children[0]!.type === 'blockquote'
    && depth < 4
  ) {
    current = current.children[0] as Blockquote;
    depth += 1;
  }
  // `>>>` produces exactly three levels. Two (`>>`) is a genuine nested quote.
  if (depth !== 3) return null;

  const first = current.children[0];
  if (!first || first.type !== 'paragraph') return null;
  const lead = first.children[0];
  if (!lead || lead.type !== 'text') return null;

  const match = CALLOUT_LINE.exec(lead.value);
  if (!match) return null;

  const tone = (match[1] ?? 'note').toLowerCase();
  const rest = match[2] ?? '';
  const remainder = rest
    ? ([{ type: 'text', value: rest } as PhrasingContent, ...first.children.slice(1)])
    : first.children.slice(1);
  return {
    tone,
    body: {
      type: 'blockquote',
      children: [{ type: 'paragraph', children: remainder.length ? remainder : [{ type: 'text', value: '' }] }],
    },
  };
}

/** Rewrite `>>>` nested quotes into single toned callout blockquotes. */
function transformCallouts(root: Root): void {
  const next: RootContent[] = [];
  for (const node of root.children) {
    if (node.type !== 'blockquote') { next.push(node); continue; }
    const collapsed = collapseCallout(node as Blockquote);
    if (!collapsed) { next.push(node); continue; }
    const callout: Blockquote = {
      type: 'blockquote',
      data: { hProperties: { className: ['cc-md-callout', `cc-md-callout-${collapsed.tone}`] } },
      children: collapsed.body.children,
    };
    // Decorate the callout body in the same pass (decorateChildren runs after
    // this function on the whole tree, but the new node is already in place).
    next.push(callout);
  }
  root.children = next;
}

/** remark plugin: decorations. */
export const remarkDecorations: Plugin<[], Root> = () => (tree) => {
  transformCallouts(tree);
  decorateChildren(tree);
};
