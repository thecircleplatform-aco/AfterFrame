// Runnable check: `npx tsx src/agent/skills/plugin-skills.check.ts`（ .verify.ts  verify:skills）
// Verifies the bundled skills are present + verbatim + parse cleanly. Reads the
// SKILL.md files from disk (not via plugin-skills.ts, which uses Vite `?raw` and can't
// load under tsx) and exercises the pure frontmatter parser on all three source shapes.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSkillFrontmatter } from './skill-frontmatter';

const SKILLS_DIR = dirname(fileURLToPath(import.meta.url));  // check \u4e0e\u6280\u80fd\u5185\u5bb9\u540c\u76ee\u5f55
const EXPECTED = [
  'ai-cinematic-short-film', 'asset-import', 'batch-montage-variants', 'beat-sync-montage',
  'create-motion-graphics', 'ecommerce-product-montage', 'explainer-video',
  'export', 'image-gen', 'known-errors', 'livestream-to-clips', 'long-video-to-shorts',
  'motion-graphic-placement',
  'multi-clips-to-reels', 'music', 'music-intelligence', 'news-rough-cut',
  'afterframe-plugin-basics', 'product-ad-video-script',
  'product-help', 'shader-gen', 'skill-creator', 'storyboard-shot-breakdown', 'talking-head-guide',
  'transcription', 'verification', 'video-gen', 'video-thumbnail-generator', 'voice',
  'widget-forms',
];

// Every expected skill dir is present, and no extras.
const slugs = readdirSync(SKILLS_DIR).filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory()).sort();
assert.deepStrictEqual(slugs, [...EXPECTED].sort(), '\u5185\u7f6e\u6280\u80fd\u5168\u90e8\u5728\u518c,\u65e0\u591a\u65e0\u5c11');

// Each SKILL.md parses to name(=slug) + non-empty description + substantive verbatim body.
for (const slug of slugs) {
  const raw = readFileSync(join(SKILLS_DIR, slug, 'SKILL.md'), 'utf8');
  const { name, description, body } = parseSkillFrontmatter(raw);
  assert.strictEqual(name, slug, `${slug}: frontmatter name \u5e94\u7b49\u4e8e slug`);
  assert.ok(description.length > 20, `${slug}: description \u89e3\u6790\u975e\u7a7a`);
  assert.ok(body.trim().length > 100, `${slug}: SKILL.md \u6b63\u6587\u6709\u5b9e\u8d28\u5185\u5bb9`);
  // Verbatim: the parsed body is a suffix of the original bytes (nothing rewritten).
  assert.ok(raw.endsWith(body), `${slug}: \u6b63\u6587\u662f\u539f\u6587\u4ef6\u7684\u9010\u5b57\u540e\u7f00（\u672a\u6539\u5199）`);
}

// Parser handles all three source description shapes.
const plain = parseSkillFrontmatter('---\nname: a\ndescription: Use when X.\n---\nBODY');
assert.strictEqual(plain.description, 'Use when X.', '\u88f8\u884c description');
const quoted = parseSkillFrontmatter('---\nname: b\ndescription: "Use for Y, Z."\n---\nBODY');
assert.strictEqual(quoted.description, 'Use for Y, Z.', '\u53cc\u5f15\u53f7 description \u53bb\u5f15\u53f7');
const block = parseSkillFrontmatter('---\nname: c\ndescription: |\n  Line one\n  line two.\nuser-invocable: true\n---\nBODY');
assert.strictEqual(block.description, 'Line one line two.', '`|` \u5757 description \u62fc\u63a5\u5e76\u5728\u4e0b\u4e2a key \u5904\u505c\u6b62');
assert.strictEqual(block.body, 'BODY', '\u5757 description \u4e0d\u541e\u6389\u6b63\u6587');

// A known skill loads a real support file (voice/references/voices.md exists on disk).
const voiceRef = readFileSync(join(SKILLS_DIR, 'voice', 'references', 'voices.md'), 'utf8');
assert.ok(voiceRef.length > 0, 'references \u652f\u6491\u6587\u4ef6\u4e5f\u968f\u6280\u80fd\u642c\u6765');

console.log(`plugin-skills.check: ok (${slugs.length} \u6280\u80fd / frontmatter \u4e09\u5f62\u6001 / references \u9f50)`);
