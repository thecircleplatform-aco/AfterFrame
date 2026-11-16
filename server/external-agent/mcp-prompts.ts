import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  type Prompt,
} from '@modelcontextprotocol/sdk/types.js';

const PROMPTS: Prompt[] = [
  {
    name: 'create-short-video',
    description: 'Cut the current project into a tight vertical short (hook, build, climax, close).',
    arguments: [{ name: 'topic', description: 'Topic / focus (optional)', required: false }],
  },
  {
    name: 'transcribe-and-caption',
    description: 'Transcribe audio and video clips on the timeline and generate captions (clips without audio are skipped).',
    arguments: [{ name: 'track', description: 'Track alias — defaults to the audio track', required: false }],
  },
  {
    name: 'add-background-music',
    description: 'Choose and place suitable background music for the current timeline, with loudness normalization.',
    arguments: [{ name: 'mood', description: 'Mood direction (optional)', required: false }],
  },
  {
    name: 'generate-script',
    description: 'Write a voice-over script for the current footage and plan the shots.',
    arguments: [{ name: 'topic', description: 'Topic', required: true }],
  },
  {
    name: 'export-project',
    description: 'Export the current project as a finished MP4 and report the export history.',
    arguments: [{ name: 'format', description: 'mp4 / prores (defaults to mp4)', required: false }],
  },
  {
    name: 'clean-up-draft',
    description: 'Review the timeline: remove filler words and silent pauses, tighten the gaps.',
    arguments: [],
  },
];

const PROMPT_TEXT: Record<string, string> = {
  'create-short-video': 'Cut the current timeline into a tight vertical short: first review the footage and settle the hook, build, climax and close, then do the cut, music, captions and a pre-publish check. Topic: {topic}.',
  'transcribe-and-caption': 'Transcribe the audio and video clips on track {track} and generate captions; clips without an audio track can be skipped. When done, report which clips were skipped.',
  'add-background-music': 'Choose and place suitable background music for the current timeline, normalize it to about -14 LUFS, and make sure it does not fight the voice-over. {topic}',
  'export-project': 'Export the current project as a finished video (MP4 by default). Check that all media is present before exporting, then report the export history and where the file went.',
  'clean-up-draft': 'Review the current timeline: remove filler words from the voice-over, cut silent pauses, tighten the gaps, and keep captions in sync with the picture.',
};

export function registerMcpPrompts(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const topic = typeof args.topic === 'string' ? args.topic.trim() : '';
    const track = typeof args.track === 'string' ? args.track.trim() : '';
    const mood = typeof args.mood === 'string' ? args.mood.trim() : '';
    const template = name === 'generate-script'
      ? `Write a voice-over script about “${topic}”: first settle the structure (opening hook, main points, closing call to action), then plan shots that match the available footage.`
      : PROMPT_TEXT[name];
    if (!template) throw new Error(`Unknown prompt ${name}`);
    const text = template
      .replace(/\{topic\}/g, topic || 'Current footage')
      .replace(/\{track\}/g, track || 'A1');
    return {
      description: PROMPTS.find((prompt) => prompt.name === name)?.description,
      messages: [{
        role: 'user',
        content: { type: 'text', text: mood ? `${text} (mood: ${mood})` : text },
      }],
    };
  });
}
