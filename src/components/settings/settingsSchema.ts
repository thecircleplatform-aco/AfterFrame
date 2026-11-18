import { FAL_MODELS } from '../../../shared/fal-models';
// Set the information architecture of the panel (first-level classification → second-level capability group → third-level provider page → fields) and pure display logic.
// Three columns: Left tree = Category → Capability; Middle column = Vendor list under this capability; Right column = Configuration page of the selected vendor.
// Agent LLM saves independent API URLs, API Keys and models for each vendor; the capability to generate classes can be additionally provided
// Default provider route. Layout/interaction is in SettingsDialog.tsx, vendor icons are in vendorIcons.tsx.
// Security invariant: the secret field only has a Boolean status, and the value will never be backfilled; the model/routing field is a non-secret configuration,
// The current value is echoed through the models channel of GET /api/keys (server-side NON_SECRET_NAMES whitelist).
import { t } from '../../i18n/locale';
import {
  isLocalLlmProvider,
  llmProviderConfigNames,
} from '../../../shared/llm-providers';
import type { CodexAgentStatus } from '../../../shared/codex-agent';
import type { CopilotAgentStatus } from '../../../shared/copilot-agent';
import type { ClaudeCodeAgentStatus } from '../../../shared/claude-code-agent';
import type { VendorId } from './vendorIcons';
import {
  directory,
  modelPicker,
  modelText,
  routeSelect,
  secret,
  text,
  type KeyStatusResponse,
  type SelectOption,
  type SettingsCategory,
  type SettingsField,
  type SettingsGroup,
  type SettingsVendorPage,
} from './settingsFields';
import {
  LOCAL_ASR_SETTINGS_ROUTE,
  ROUTE_NEEDS,
  TRANSCRIPTION_SETTINGS_GROUP,
  VOICE_SETTINGS_GROUP,
  localAsrPage,
} from './settingsMediaProviders';
import { AGENT_VENDOR_PAGES_WITH_VISION, PROXY_PAGE } from './settingsAgentProviders';

export type {
  FieldKind,
  KeyState,
  KeyStatusResponse,
  SelectOption,
  SettingsCategory,
  SettingsField,
  SettingsGroup,
  SettingsVendorPage,
} from './settingsFields';

const MINIMAX_NOTE = 'One MiniMax Key works for all capabilities (image generation / voiceover / video / music) after a single configuration.';
const minimaxPage = (cap: string, modelField: SettingsField, title = 'MiniMax', vendor: VendorId = 'minimax'): SettingsVendorPage => ({
  key: `${cap}/${vendor}`, vendor, title, note: MINIMAX_NOTE,
  fields: [
    secret('MINIMAX_API_KEY', 'API Key'),
    text('MINIMAX_BASE_URL', 'Base URL', 'Default: https://api.minimaxi.com'),
    modelField,
  ],
});

// BytePlus ModelArk serves image (Seedream) and video (Seedance) from the same Key/Base URL,
// separate from LLM_BYTEPLUS_* (Agent chat) — same sharing convention as MiniMax above.
const BYTEPLUS_NOTE = 'BytePlus ModelArk uses one Key for both image and video generation; separate from the BytePlus config for “Agent Brain”.';
const byteplusPage = (cap: string, modelField: SettingsField, title = 'BytePlus · ModelArk'): SettingsVendorPage => ({
  key: `${cap}/byteplus`, vendor: 'byteplus', title, note: BYTEPLUS_NOTE,
  fields: [
    secret('BYTEPLUS_API_KEY', 'API Key'),
    text('BYTEPLUS_BASE_URL', 'Base URL', 'Default: https://ark.ap-southeast.bytepluses.com/api/v3'),
    modelField,
  ],
});

const falPage = (cap: 'image' | 'video'): SettingsVendorPage => ({
  key: `${cap}/fal`, vendor: 'fal', title: 'Fal.ai',
  note: 'Select Fal.ai as the default provider, then choose a model. Models specified in chat take priority over this default.',
  fields: [
    secret('FAL_KEY', 'API Key'),
    {
      name: cap === 'image' ? 'FAL_IMAGE_MODEL' : 'FAL_VIDEO_MODEL',
      label: cap === 'image' ? 'Image generation model' : 'Video model', kind: 'select',
      options: [
        { value: '', label: 'Per request (default)' },
        ...FAL_MODELS.filter((model) => model.kind === cap).map(({ id, label }) => ({ value: id, label })),
      ],
    },
  ],
});

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    key: 'agent', title: 'Agent model', icon: 'sparkles',
    groups: [
      { key: 'llm', title: 'Agent brain',
        vendors: AGENT_VENDOR_PAGES_WITH_VISION },
    ],
  },
  {
    key: 'proxy', title: 'Network proxy', icon: 'plug',
    groups: [
      { key: 'proxy', title: 'Network proxy', hint: 'Configure a unified proxy address for server-side access to overseas APIs.', vendors: [PROXY_PAGE] },
    ],
  },
  {
    // Free tier (bring-your-own-key) vs hosted tier, plus the optional offline
    // component installs. Rendered by a custom pane — `fields: []` because none
    // of it is a server env key.
    key: 'plan', title: 'Plans & keys', icon: 'sparkles',
    groups: [
      { key: 'plan', title: 'Plans & keys', hint: 'Run with your own API key, or use the hosted tier. Offline components download on demand.', vendors: [
        { key: 'plan/tier', vendor: 'localasr', title: 'Plan and API keys', icon: 'sparkles', kind: 'local-models', fields: [] },
      ] },
    ],
  },
  {
    key: 'generation', title: 'AI generated', icon: 'image',
    groups: [
      { key: 'image', title: 'Image Generation', hint: 'submit_image · Text-to-image / image-to-image with any provider.',
        route: routeSelect('PREFERRED_IMAGE_VENDOR', [
          { value: 'fal', label: 'Fal.ai' },
          { value: 'gpt-image-2', label: 'OpenAI gpt-image' },
          { value: 'nano-banana', label: 'Gemini Nano Banana' },
          { value: 'image-01', label: 'MiniMax' },
          { value: 'wavespeed', label: 'WaveSpeed' },
          { value: 'byteplus', label: 'BytePlus · Seedream' },
          { value: 'grok-imagine', label: 'xAI Grok Imagine' },
          { value: 'agnes-image', label: 'Agnes Image' },
        ]),
        vendors: [
          { key: 'image/openai', vendor: 'openai', title: 'OpenAI', fields: [
            secret('IMAGE_API_KEY', 'API Key（gpt-image）'),
            text('IMAGE_BASE_URL', 'Base URL', 'Default: https://api.openai.com'),
          ] },
          { key: 'image/gemini', vendor: 'gemini', title: 'Google Gemini', fields: [
            secret('GEMINI_API_KEY', 'API Key（Nano Banana）'),
            text('GEMINI_BASE_URL', 'Base URL', 'Default: https://generativelanguage.googleapis.com'),
            modelText('GEMINI_IMAGE_MODEL', 'Image generation model', 'gemini-3.1-flash-image'),
          ] },
          falPage('image'),
          minimaxPage('image', modelPicker('MINIMAX_IMAGE_MODEL', 'Image generation model', 'image-01', ['image-01', 'image-01-live'])),
          { key: 'image/wavespeed', vendor: 'wavespeed', title: 'WaveSpeed', fields: [
            secret('WAVESPEED_API_KEY', 'API Key'),
            text('WAVESPEED_BASE_URL', 'Base URL', 'Default: https://api.wavespeed.ai'),
            modelText('WAVESPEED_IMAGE_MODEL', 'Image generation model', 'wavespeed-ai/flux-dev'),
          ] },
          byteplusPage('image', modelText('BYTEPLUS_IMAGE_MODEL', 'Image generation model', 'seedream-4-5-251128',
            'After testing the connection, select a model returned by the API or enter a model ID manually.', true), 'BytePlus · Seedream'),
          { key: 'image/xai', vendor: 'xai', title: 'xAI · Grok Imagine',
            note: 'Uses an xAI subscription session (SuperGrok / X Premium+, preferred) or LLM_XAI_API_KEY to generate images. Text-to-image: up to 4 images, 1K / 2K.',
            fields: [
              modelText('XAI_IMAGE_MODEL', 'Image generation model', 'grok-imagine-image-2.0',
                'After testing the connection, select a model returned by the API or enter a model ID manually.', true),
            ] },
          { key: 'image/agnes', vendor: 'agnes', title: 'Agnes AI',
            note: 'Agnes Image 2.5 Flash, text-to-image and image-to-image. Size tiers 1K/2K/3K/4K, supports multiple aspect ratios.',
            fields: [
              secret('AGNES_IMAGE_API_KEY', 'API Key'),
              text('AGNES_IMAGE_BASE_URL', 'Base URL', 'Default: https://apihub.agnes-ai.com/v1'),
              modelText('AGNES_IMAGE_MODEL', 'Image generation model', 'agnes-image-2.5-flash'),
            ] },
        ] },
      VOICE_SETTINGS_GROUP,
      { key: 'video', title: 'Generate video', hint: 'submit_video · Text / image to video with any provider.',
        route: routeSelect('PREFERRED_VIDEO_VENDOR', [
          { value: 'fal', label: 'Fal.ai' },
          { value: 'seedance2', label: 'Seedance' },
          { value: 'kling', label: 'Kling' },
          { value: 'hailuo', label: 'MiniMax Hailuo' },
          { value: 'byteplus', label: 'BytePlus · Seedance' },
          { value: 'grok-imagine-video', label: 'xAI Grok Imagine' },
          { value: 'gemini-omni', label: 'Google · Gemini Omni' },
          { value: 'ofox', label: 'OFox · Multi-model' },
          { value: 'agnes-video', label: 'Agnes Video' },
        ]),
        vendors: [
          falPage('video'),
          { key: 'video/seedance', vendor: 'seedance', title: 'Seedance · Volcano', fields: [
            secret('SEEDANCE_API_KEY', 'API Key'),
            text('SEEDANCE_BASE_URL', 'Base URL', 'Default: https://ark.cn-beijing.volces.com/api/v3'),
            modelText('SEEDANCE_VIDEO_MODEL', 'Video model', 'doubao-seedance-2-0-260128'),
          ] },
          { key: 'video/kling', vendor: 'kling', title: 'Kling', fields: [
            secret('KLING_API_KEY', 'API Key'),
            text('KLING_BASE_URL', 'Base URL', 'Default: https://api-singapore.klingai.com'),
            modelText('KLING_VIDEO_MODEL', 'Video model', 'kling-v3-omni'),
          ] },
          minimaxPage('video', modelPicker('MINIMAX_VIDEO_MODEL', 'Video model', 'MiniMax-Hailuo-02',
            ['MiniMax-Hailuo-02', 'MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'S2V-01']), 'MiniMax Hailuo', 'hailuo'),
          byteplusPage('video', modelText('BYTEPLUS_VIDEO_MODEL', 'Video model', 'seedance-1-5-pro-251215',
            'After testing the connection, select a model returned by the API or enter a model ID manually.', true), 'BytePlus · Seedance'),
          { key: 'video/xai', vendor: 'xai', title: 'xAI · Grok Imagine (Video)',
            note: 'Uses an xAI subscription session (SuperGrok / X Premium+, preferred) or LLM_XAI_API_KEY to generate video. Text-to-video: 1–15 seconds, with audio track, 480p / 720p / 1080p.',
            fields: [
              modelText('XAI_VIDEO_MODEL', 'Video model', 'grok-imagine-video-1.5',
                'After testing the connection, select a model returned by the API or enter a model ID manually.', true),
            ] },
          { key: 'video/gemini-omni', vendor: 'gemini', title: 'Google · Gemini Omni Flash',
            note: 'Uses GEMINI_API_KEY (same as Nano Banana image generation). Text-to-video / image-to-video / first-last frame / up to 6 reference images; aspect ratios only 16:9 and 9:16; resolutions 360p / 720p / 1080p / 4k; duration 3–15 seconds (first-last frame 3–10 seconds, defaults to 10 seconds if omitted). Default model: gemini-omni-1.2-flash.',
            fields: [
              secret('GEMINI_API_KEY', 'API Key'),
              text('GEMINI_BASE_URL', 'Base URL', 'Default: https://generativelanguage.googleapis.com'),
              modelText('GEMINI_OMNI_VIDEO_MODEL', 'Video model', 'gemini-omni-1.2-flash',
                'Omni video model ID for Google AI Studio / Gemini API.'),
            ] },
          { key: 'video/ofox', vendor: 'ofox', title: 'OFox · Multi-model gateway',
            note: 'Uses LLM_OFOX_API_KEY (configure OFox in Agent providers) to generate video. One Key covers Seedance, Wan, and other video models; supports text-to-video, first-frame/first-last-frame image-to-video, and image references (up to 9); duration/resolution are validated by the API per model, 2–30 seconds.',
            fields: [
              modelText('OFOX_VIDEO_MODEL', 'Video model', 'bytedance/seedance-2.0-fast',
                'After testing the connection, select a model returned by the API or enter a model ID manually.', true),
            ] },
          { key: 'video/agnes', vendor: 'agnes', title: 'Agnes AI',
            note: 'Agnes Video 2.5 Flash, text-to-video, first/last frame control, and image/audio references. Fixed 720P, duration 4–12 seconds.',
            fields: [
              secret('AGNES_VIDEO_API_KEY', 'API Key'),
              text('AGNES_VIDEO_BASE_URL', 'Base URL', 'Default: https://apihub.agnes-ai.com/v1'),
              modelText('AGNES_VIDEO_MODEL', 'Video model', 'agnes-video-2.5-flash'),
            ] },
        ] },
      { key: 'music', title: 'Generate music', hint: 'submit_music · Generate music from text / final cut with any provider.',
        route: routeSelect('PREFERRED_MUSIC_VENDOR', [
          { value: 'mureka', label: 'Mureka' },
          { value: 'minimax', label: 'MiniMax' },
          { value: 'atlas', label: 'Atlas Cloud' },
          { value: 'sonilo', label: 'Sonilo' },
        ]),
        vendors: [
          { key: 'music/mureka', vendor: 'mureka', title: 'Mureka', fields: [
            secret('MUREKA_API_KEY', 'API Key'),
            text('MUREKA_BASE_URL', 'Base URL', 'Default: https://api.mureka.ai'),
            modelText('MUREKA_MUSIC_MODEL', 'Music model', 'auto'),
          ] },
          minimaxPage('music', modelPicker('MINIMAX_MUSIC_MODEL', 'Music model', 'music-2.6',
            ['music-3.0', 'music-2.6', 'music-3.0-free', 'music-2.6-free', 'music-cover', 'music-cover-free'])),
          { key: 'music/atlas', vendor: 'atlas', title: 'Atlas Cloud', fields: [
            secret('ATLASCLOUD_API_KEY', 'API Key'),
            text('ATLASCLOUD_API_BASE', 'Base URL', 'Default: https://api.atlascloud.ai/api/v1'),
            modelPicker('ATLASCLOUD_MUSIC_MODEL', 'Music model', 'minimax/music-2.6', ['minimax/music-2.6']),
          ] },
          { key: 'music/sonilo', vendor: 'sonilo', title: 'Sonilo',
            note: 'Generate from final cut: Pass the rendered video to Sonilo, and the soundtrack follows the visual rhythm (optional one-line style prompt; can be left blank).'
              + 'Music is licensed and commercially usable (subject to terms); each track includes a license_id for records.'
              + 'The same Key is also used to generate sound effects from the final cut (submit_sound, royalty-free).',
            fields: [
              secret('SONILO_API_KEY', 'API Key'),
              text('SONILO_BASE_URL', 'Base URL', 'Default: https://api.sonilo.com'),
            ] },
        ] },
    ],
  },
  {
    key: 'assets', title: 'Assets · Transcription', icon: 'folder',
    groups: [
      { key: 'stock', title: 'Online gallery', hint: 'search_stock_media · Search commercially usable image / video assets.',
        vendors: [
          { key: 'stock/pexels', vendor: 'pexels', title: 'Pexels', fields: [secret('PEXELS_API_KEY', 'API Key')] },
          { key: 'stock/pixabay', vendor: 'pixabay', title: 'Pixabay', fields: [secret('PIXABAY_API_KEY', 'API Key')] },
          { key: 'stock/unsplash', vendor: 'unsplash', title: 'Unsplash', fields: [secret('UNSPLASH_ACCESS_KEY', 'Access Key')] },
          { key: 'stock/freesound', vendor: 'freesound', title: 'Freesound', fields: [secret('FREESOUND_API_KEY', 'API Key')] },
        ] },
      TRANSCRIPTION_SETTINGS_GROUP,
    ],
  },
  {
    key: 'cloud', title: 'Storage', icon: 'cloud',
    groups: [
      { key: 'storage', title: 'Default project location', hint: 'Default save location for new projects and generated assets, plus optional R2 cloud backup.',
        vendors: [
          { key: 'storage/projects', vendor: 'localdisk', title: 'Default project location',
            note: 'New projects, historical versions, and app-generated assets are saved here. On desktop, files and folders dragged in from outside remain in their original location,'
              + 'The project only stores references; the browser uploads a hosted copy at runtime. Restart the app for changes to take effect.',
            fields: [
              directory('AFTERFRAME_DATA_DIR', 'Default project location', 'App default data directory',
                'On desktop, click \'Select Directory\'; you can also enter an absolute path manually (may start with ~/). Clear it to return to the default directory.'),
            ] },
          { key: 'storage/r2', vendor: 'r2', title: 'Cloudflare R2',
            note: 'When unconfigured, assets are stored locally only. Once configured, every upload also writes to R2 (bucket stays private,'
              + 'Reads are served through the local service; the src path remains unchanged); if local files are missing, they are automatically fetched from the cloud. Changes take effect immediately.'
              + 'Create a bucket in the R2 console → R2 API Token (Object Read & Write) to get the four values below.',
            fields: [
              { name: 'R2_ENABLED', label: 'Cloud sync', kind: 'toggle',
                note: 'When disabled, new uploads are stored locally only (key retained; files already in cloud unaffected); re-enabling restores write-through.' },
              secret('R2_ACCOUNT_ID', 'Account ID'),
              secret('R2_ACCESS_KEY_ID', 'Access Key ID'),
              secret('R2_SECRET_ACCESS_KEY', 'Secret Access Key'),
              secret('R2_BUCKET', 'Bucket name'),
            ] },
        ] },
    ],
  },
  {
    key: 'tools', title: 'Enhancement tools', icon: 'sliders',
    groups: [
      { key: 'sandbox', title: 'Sandbox execution', hint: 'run_code · Run ffmpeg / node / python in a cloud sandbox.',
        vendors: [
          { key: 'sandbox/e2b', vendor: 'e2b', title: 'E2B',
            note: 'Cloud-isolated Linux sandbox; does not touch local files. Agent uses it to run run_code: ffprobe to probe media duration / '
              + 'Size encoding, ffmpeg transcoding / frame extraction / audio-video processing, running node / python skill scripts; after results are returned'
              + 'Local tools apply them to the timeline. If unconfigured, only these tools are affected; editing and preview are unaffected.',
            fields: [
              secret('E2B_API_KEY', 'API Key'),
              text('E2B_TEMPLATE', 'Template ID (optional)', undefined,
                'The default template does not include ffmpeg; transcode / frame extraction tasks require a custom template with ffmpeg and its ID.'),
            ] },
        ] },
      { key: 'web', title: 'Web scraping', hint: 'web_browser · Fetch web page content for Agent reference.',
        vendors: [
          { key: 'web/firecrawl', vendor: 'firecrawl', title: 'Firecrawl',
            fields: [secret('FIRECRAWL_API_KEY', 'API Key')] },
        ] },
      { key: 'publish', title: 'Publish to social platforms', hint: 'publish_to_social · Publish exported videos to TikTok, Instagram, YouTube, and other platforms.',
        vendors: [
          { key: 'publish/upload-post', vendor: 'uploadpost', title: 'Upload-Post',
            note: 'Publish to TikTok, Instagram, YouTube, LinkedIn, Facebook, X, Threads, Pinterest, and Bluesky with one Key.'
              + 'First create a Profile in Upload-Post and connect platform accounts, then enter the Profile name below.'
              + 'Before publishing, the Agent always previews the platform, title, and video and uploads only after your confirmation; YouTube defaults to private.',
            fields: [
              secret('UPLOAD_POST_API_KEY', 'API Key'),
              text('UPLOAD_POST_PROFILE', 'Profile', undefined, 'Name of the Profile created in the Upload-Post console and connected to social accounts.'),
            ] },
        ] },
    ],
  },
  {
    key: 'interface', title: 'Interface', icon: 'layoutPanel',
    groups: [
      { key: 'display', title: 'Display', hint: 'Settings for interface scaling and display.',
        vendors: [
          { key: 'display/scale', vendor: 'localasr', title: 'UI Scale',
            note: 'Adjust the zoom level for the entire editor (80%–150%). In the desktop app, changes take effect immediately after saving; you can also use Ctrl/Cmd + +/- to adjust quickly and Ctrl/Cmd + 0 to reset. In the browser version, use the browser\'s built-in zoom.',
            fields: [
              { name: 'UI_SCALE', label: 'UI Scale', kind: 'select', defaultLabel: '100%',
                options: [
                  { value: '0.8', label: '80%' },
                  { value: '0.9', label: '90%' },
                  { value: '1', label: '100%' },
                  { value: '1.1', label: '110%' },
                  { value: '1.25', label: '125%' },
                  { value: '1.5', label: '150%' },
                ] },
            ] },
        ] },
    ],
  },
  {
    key: 'local', title: 'Local Model', icon: 'database',
    groups: [
      { key: 'local', title: 'Local Model', hint: 'Local transcription, beat and music analysis, semantic visual search. Models install on demand; data stays on-device.',
        vendors: [
          { key: LOCAL_ASR_SETTINGS_ROUTE, vendor: 'localasr', title: 'Local Transcription', icon: 'mic', kind: 'local-models', fields: localAsrPage.fields },
          { key: 'local/music/packs', vendor: 'localasr', title: 'Beat and music analysis', icon: 'music', kind: 'local-models', fields: [] },
          { key: 'local/semantic/setup', vendor: 'localasr', title: 'Visual semantic search', icon: 'search', kind: 'local-models', fields: [] },
        ] },
    ],
  },
];

/** Temporary changes: field name in map = temporary storage; '' = clear explicitly (model fields will return to default).*/
export type StagedValues = Record<string, string>;

export function omitKey(obj: StagedValues, name: string): StagedValues {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== name));
}

/** '' is explicitly cleared and sent as is; non-null values ​​are sent after trimming; pure blank input is regarded as unchanged (to prevent misclearing).*/
export function buildPatch(values: StagedValues): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const [name, raw] of Object.entries(values)) {
    if (raw === '') patch[name] = '';
    else if (raw.trim() !== '') patch[name] = raw.trim();
  }
  return patch;
}

export function savedMessage(): string {
  return t('Saved · Tool takes effect immediately; Agent will notice on the next message.');
}

/** Whether the field goes through the non-confidential models value channel (current value echo; temporary baseline = current value on the server; clear = return to default).*/
export function isModelField(field: SettingsField): boolean {
  return field.kind === 'select' || field.kind === 'toggle' || field.defaultLabel !== undefined;
}

/** Current model/routing value on the server ('' = not set = use default).*/
export function modelValue(status: KeyStatusResponse | null, name: string): string {
  return status?.models?.[name] ?? '';
}

/** provider page "Configured": Every secret field on the page is configured; */
export function vendorConfigured(
  status: KeyStatusResponse | null,
  page: SettingsVendorPage,
  codexStatus?: CodexAgentStatus | null,
  copilotStatus?: CopilotAgentStatus | null,
  claudeCodeStatus?: ClaudeCodeAgentStatus | null,
): boolean {
  if (page.connection === 'codex') {
    return Boolean(codexStatus?.installed && codexStatus.account?.type === 'chatgpt');
  }
  if (page.connection === 'copilot') {
    return Boolean(copilotStatus?.installed && copilotStatus.supported && copilotStatus.authenticated);
  }
  if (page.connection === 'claude-code') {
    return Boolean(claudeCodeStatus?.installed && claudeCodeStatus.account?.loggedIn);
  }
  if (page.connection === 'xai-oauth') {
    return Boolean(status?.keys?.LLM_XAI_OAUTH_API_KEY?.configured);
  }
  if (!status) return false;
  if (isLocalLlmProvider(page.vendor)) {
    const names = llmProviderConfigNames(page.vendor);
    return Boolean(status.models[names.model]?.trim());
  }
  const secrets = page.fields.filter((f) => f.kind === 'secret');
  if (secrets.length === 0) return page.fields.some((f) => Boolean(status.keys[f.name]?.configured));
  return secrets.every((f) => Boolean(status.keys[f.name]?.configured));
}
/** Determination of configured capability group: LLM and proxy are page-backed; others use server capability flags. */
export function groupConfigured(
  status: KeyStatusResponse | null,
  group: SettingsGroup,
  codexStatus?: CodexAgentStatus | null,
  copilotStatus?: CopilotAgentStatus | null,
  claudeCodeStatus?: ClaudeCodeAgentStatus | null,
): boolean {
  if (group.key === 'llm' || group.key === 'proxy') {
    return group.vendors.some((page) =>
      vendorConfigured(status, page, codexStatus, copilotStatus, claudeCodeStatus));
  }
  return status ? Boolean(status.caps[group.key]) : false;
}

/** Classification logo: Number of configured capabilities/Total number of capabilities (capability level count).*/
export function categoryGroupStats(
  status: KeyStatusResponse | null,
  category: SettingsCategory,
  codexStatus?: CodexAgentStatus | null,
  copilotStatus?: CopilotAgentStatus | null,
  claudeCodeStatus?: ClaudeCodeAgentStatus | null,
): { done: number; total: number } {
  return {
    done: category.groups
      .filter((group) =>
        groupConfigured(status, group, codexStatus, copilotStatus, claudeCodeStatus)).length,
    total: category.groups.length,
  };
}

/** Select key → ability group in the left tree (the group key is globally unique); if not found, fall back to the first group.*/
export function findGroup(key: string): SettingsGroup {
  return SETTINGS_CATEGORIES.flatMap((c) => c.groups).find((g) => g.key === key)
    ?? SETTINGS_CATEGORIES[0].groups[0];
}

/** Complete options for select rendering: insert "default (xxx)" before model select; routing select comes with "ask every time".*/
export function selectOptions(field: SettingsField): readonly SelectOption[] {
  const base = field.options ?? [];
  if (field.defaultLabel === undefined) return base;
  return [{ value: '', label: t('Default ({name})', { name: t(field.defaultLabel) }) }, ...base];
}

// Routing requirements live beside the provider groups so settings and capability
// expansion share one focused provider-data surface.

/** Routing drop-down option copy: Add the "(not configured)" suffix when the provider has not configured it, and it is still optional (there is a fallback inquiry guardrail on the Agent side).
 * Non-routing select (model drop-down) returns unchanged.*/
export function selectOptionLabel(
  status: KeyStatusResponse | null, field: SettingsField, opt: SelectOption,
): string {
  if (!field.name.startsWith('PREFERRED_') || opt.value === '') return t(opt.label);
  const needs = ROUTE_NEEDS[opt.value];
  const has = (n: string): boolean => Boolean(status?.keys[n]?.configured);
  const ok = Boolean(needs?.some((group) => group.every(has)));
  return ok ? t(opt.label) : t('{name} (not configured)', { name: t(opt.label) });
}

/** Input box placeholder: secret / Ordinary text never backfills, only describes the status; model text describes the default value.*/
export function fieldPlaceholder(field: SettingsField, configured: boolean, stagedClear: boolean): string {
  if (isModelField(field)) {
    if (stagedClear) return t('Restore defaults · takes effect after saving');
    return field.defaultLabel ? t('Default {name}', { name: t(field.defaultLabel) }) : t('Default');
  }
  if (stagedClear) return t('Will be cleared · takes effect after saving');
  if (configured) return field.placeholder ? t('Customized · leave blank to keep unchanged') : t('Configured · leave blank to keep unchanged');
  return field.placeholder ? t(field.placeholder) : t('Not configured · paste to enable');
}
