import type { AgentToolSchema } from '../../tool-schema';

export const RUN_SKILL_SCRIPT_TOOL_NAMES = new Set(['run_skill_script']);

export const RUN_SKILL_SCRIPT_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'run_skill_script',
    description: 'nullable',
    input_schema: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'Skill slug (skill field returned by load_skill)' },
        command: { type: 'string', description: 'Command (first word must be a whitelisted executable), e.g. bash scripts/check-deps.sh or node scripts/render.mjs' },
        timeout: { type: 'number', description: 'Optional: timeout in milliseconds, default 60000, max 120000' },
      },
      required: ['skill', 'command'],
    },
  },
];
