import type { AgentToolSchema } from '../../tool-schema';

export const PLAN_TOOL_SCHEMAS: AgentToolSchema[] = [{
  name: 'propose_plan',
  description:
    'Present an executable plan as an editable step list with a Run button. Use this in Plan mode instead of writing a numbered list in prose. Each step is one meaningful operation with its exact target, so the user can edit or delete steps before running them. Do not call this and also repeat the steps as markdown — the card is the plan.',
  input_schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description: 'Ordered steps: { title, detail? }. 3–12 steps is typical; keep each title under ~70 characters.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short imperative step, e.g. "Trim the intro to the first beat".' },
            detail: { type: 'string', description: 'Optional specifics: track alias, clip id, frame range, expected result.' },
          },
          required: ['title'],
        },
      },
      title: { type: 'string', description: 'Optional plan title, e.g. "Tighten the talking-head cut".' },
      note: { type: 'string', description: 'Optional caveat or prerequisite worth showing above the buttons.' },
    },
    required: ['steps'],
  },
}];

export const PLAN_TOOL_NAMES = new Set(PLAN_TOOL_SCHEMAS.map((tool) => tool.name));
