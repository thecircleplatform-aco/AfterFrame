import type { AgentToolSchema } from '../../tool-schema';


export const INSTALL_SKILL_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'install_skill',
    description: 'nullable',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'GitHub repo: full URL (https://github.com/owner/repo) or owner/repo' },
        slug: { type: 'string', description: 'Optional: install directory name (must be kebab-case), defaults to SKILL.md frontmatter name or repo name' },
      },
      required: ['repo'],
    },
  },
];

export const INSTALL_SKILL_TOOL_NAMES = new Set(INSTALL_SKILL_TOOL_SCHEMAS.map((t) => t.name));
