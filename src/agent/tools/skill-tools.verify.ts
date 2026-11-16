// :`npx tsx src/agent/tools/skill-tools.check.ts`
// manage_skill  current / activate( dump ):current /
// activate  id +  ctx.setCreativeMode  +  setter
//  CRUD  IDB(),node  refresh ——
import assert from 'node:assert';
import { execSkillTool, SKILL_TOOL_NAMES, SKILL_TOOL_SCHEMAS } from './skill-tools';
import { CREATIVE_SKILLS } from '../skills/skills-catalog';
import type { AgentContext } from '../context';

assert.ok(SKILL_TOOL_NAMES.has('manage_skill'));
const actions = (SKILL_TOOL_SCHEMAS[0].input_schema as unknown as { properties: { action: { enum: string[] } } }).properties.action.enum;
for (const a of ['list', 'get', 'current', 'activate', 'create', 'update', 'delete']) {
  assert.ok(actions.includes(a), `schema \u5e94\u542b action ${a}`);
}

// :
let mode: string | null = null;
const ctx = {
  getCreativeMode: () => mode,
  setCreativeMode: (id: string | null) => { mode = id; },
} as unknown as AgentContext;

const builtinId = CREATIVE_SKILLS[0]?.id ?? null;

// ---- current: → active:null ----
{
  const r = await execSkillTool('manage_skill', { action: 'current' }, ctx) as { active: unknown; note?: string };
  assert.strictEqual(r.active, null, '\u672a\u9009\u6a21\u5f0f\u5e94\u56de active:null');
  assert.ok(r.note?.includes('\u672a\u9009'), '\u5e94\u5e26\u672a\u9009\u8bf4\u660e');
}

// ---- activate  →  + ;current  ----
// (node  getPluginSkill  Vite `?raw`, → CREATIVE_SKILLS ,
// ,)
if (builtinId) {
  const r = await execSkillTool('manage_skill', { action: 'activate', skillId: builtinId }, ctx) as {
    ok?: boolean; active?: { id: string; builtin: boolean }; note?: string;
  };
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.active?.id, builtinId);
  assert.strictEqual(r.active?.builtin, true, '\u5185\u7f6e\u6280\u80fd\u5e94\u6807 builtin');
  assert.ok(r.note?.includes('\u4e0b\u4e00\u6761\u6d88\u606f'), '\u5e94\u8bf4\u660e\u6ce8\u5165\u65f6\u673a(system \u6bcf\u6b21 runAgent \u6784\u5efa\u4e00\u6b21)');
  assert.strictEqual(mode, builtinId, 'ctx.setCreativeMode \u5e94\u88ab\u8c03\u7528');

  const cur = await execSkillTool('manage_skill', { action: 'current' }, ctx) as { active: { id: string } };
  assert.strictEqual(cur.active.id, builtinId, 'current \u5e94\u8bfb\u56de\u6fc0\u6d3b\u7684\u6a21\u5f0f');

  const unknown = await execSkillTool('manage_skill', { action: 'activate', skillId: 'skill_nope' }, ctx) as { error?: string };
  assert.ok(unknown.error?.includes('no skill'), '\u672a\u77e5 id \u5e94\u62a5\u9519');
  assert.strictEqual(mode, builtinId, '\u62a5\u9519\u4e0d\u5e94\u6539\u52a8\u5f53\u524d\u6a21\u5f0f');
}

// ---- activate  →  ----
{
  const r = await execSkillTool('manage_skill', { action: 'activate', skillId: '' }, ctx) as { ok?: boolean; active?: unknown };
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.active, null);
  assert.strictEqual(mode, null, '\u7a7a\u4e32\u5e94\u6e05\u9664\u6a21\u5f0f');
}

// ----  setter( check  ctx)→  ----
{
  const bare = { getCreativeMode: () => null } as unknown as AgentContext;
  const r = await execSkillTool('manage_skill', { action: 'activate', skillId: builtinId ?? 'skill_any' }, bare) as { error?: string };
  assert.ok(r.error, '\u65e0 setCreativeMode \u7684\u5bbf\u4e3b\u5e94\u62a5\u9519\u800c\u975e\u9759\u9ed8');
}

console.log('skill-tools.check: ALL PASSED');
