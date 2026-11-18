import type { AgentToolSchema } from '../../tool-schema';

export const DEPENDENCY_TOOL_SCHEMAS: AgentToolSchema[] = [
  {
    name: 'ensure_dependencies',
    description: [
      'Inspect and provision the local tooling this app needs (ffmpeg, whisper.cpp, MediaPipe).',
      'Use it when a task failed because something is not installed, instead of telling the user to run a terminal command.',
      'action="check" lists what is ready and what is missing, with the consequence of each gap.',
      'action="install" starts the installer for one missing id. It is a local change, so get consent first:',
      'call action="check", then use ask_followup_questions to name the gap and offer Install / Skip.',
      'Only call action="install" after the user picks Install. Then continue immediately — the installer runs in the',
      'background and returns state="installing" rather than blocking. Never start the same install twice.',
      'Always re-check before retrying the original task.',
    ].join(' '),
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check', 'install'],
          description: 'check = list status; install = provision one missing dependency.',
        },
        id: {
          type: 'string',
          enum: [
            'ffmpeg', 'whisper-cli', 'whisper-model', 'mediapipe',
            'rhythm-pack', 'music-semantics-pack',
          ],
          description: 'Required for action="install": which dependency to provision.',
        },
      },
      required: ['action'],
    },
  },
];

export const DEPENDENCY_TOOL_NAMES = new Set(DEPENDENCY_TOOL_SCHEMAS.map((t) => t.name));
