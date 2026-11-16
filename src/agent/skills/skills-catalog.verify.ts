// Runnable check: `npx tsx src/agent/skills-catalog.check.ts`.
// Verifies the creative-skill catalog against the SKILL.md files on disk
// (no Vite ?raw glob — this runs under plain tsx/node), plus the
// prompt-injection helper and findSkill behavior.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CREATIVE_SKILL_METADATA, findSkill } from './skills-catalog';
import { parseSkillFrontmatter } from './skill-frontmatter';
import { creativeModePrompt } from '../systemPrompt';

const SKILLS_DIR = dirname(fileURLToPath(import.meta.url));

// Every creative-skill metadata entry resolves to a real SKILL.md on disk with
// name=slug, a non-empty description, and a substantive body.
const slugs = CREATIVE_SKILL_METADATA.map((m) => m.slug);
assert.strictEqual(slugs.length, 11, 'expected 11 creative skills');
for (const slug of slugs) {
  const raw = readFileSync(join(SKILLS_DIR, slug, 'SKILL.md'), 'utf8');
  const { name, description, body } = parseSkillFrontmatter(raw);
  assert.strictEqual(name, slug, `${slug}: frontmatter name \u5e94\u7b49\u4e8e slug`);
  assert.ok(description.length > 20, `${slug}: description \u89e3\u6790\u975e\u7a7a`);
  assert.ok(body.trim().length > 500, `${slug}: \u521b\u4f5c\u6280\u80fd\u6b63\u6587\u6709\u5b9e\u8d28\u5185\u5bb9`);
}
for (const s of CREATIVE_SKILL_METADATA) {
  assert.ok(s.id && s.name && s.nameZh, `skill ${s.name} is well-formed`);
  assert.ok(Array.isArray(s.scenarios), 'scenarios is an array');
}

// a known real skill is present with its zh name
const shorts = CREATIVE_SKILL_METADATA.find((s) => s.name === 'Long Video to Shorts');
assert.ok(shorts, 'Long Video to Shorts present');
assert.strictEqual(shorts!.nameZh, '\u957f\u89c6\u9891\u8f6c\u77ed\u89c6\u9891');
const livestream = CREATIVE_SKILL_METADATA.find((s) => s.name === 'Livestream to Clips');
assert.ok(livestream, 'Livestream to Clips present');
assert.strictEqual(livestream!.nameZh, '\u76f4\u64ad\u667a\u80fd\u5207\u7247');

// findSkill: null/undefined/unknown → undefined (id-hit lookups are covered in
// skill-loading.verify.ts where the Vite glob is available).
assert.strictEqual(findSkill(null), undefined);
assert.strictEqual(findSkill(undefined), undefined);
assert.strictEqual(findSkill('nope'), undefined);

// creativeModePrompt: empty for no skill, wraps the skill body otherwise.
// The loader instruction must not embed the body (progressive disclosure).
const prompt = creativeModePrompt({
  id: shorts!.id,
  slug: shorts!.slug,
  name: shorts!.name,
  nameZh: shorts!.nameZh,
  summary: shorts!.summary,
  scenarios: shorts!.scenarios,
  description: 'desc',
  body: 'BODY_SENTINEL',
  files: [],
  source: 'builtin',
});
assert.ok(prompt.includes('<selected_skill>') && prompt.includes(shorts!.slug), 'prompt names the selected skill');
assert.ok(prompt.includes('call load_skill'), 'prompt instructs load_skill first');
assert.ok(!prompt.includes('BODY_SENTINEL'), 'prompt must not embed the skill body (progressive disclosure)');

console.log('skills-catalog.check: ok');
