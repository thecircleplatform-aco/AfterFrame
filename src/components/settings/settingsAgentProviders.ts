import {
  LLM_PROVIDER_PRESETS,
  isLocalLlmProvider,
  llmProviderConfigNames,
} from '../../../shared/llm-providers';
import type { VendorId } from './vendorIcons';
import { secret, text, type SettingsVendorPage } from './settingsFields';

const llmPage = (preset: (typeof LLM_PROVIDER_PRESETS)[number]): SettingsVendorPage => {
  const names = llmProviderConfigNames(preset.id);
  return {
    key: `llm/${preset.id}`,
    vendor: preset.id as VendorId,
    title: preset.label,
    note: preset.id === 'anthropic'
      ? 'The built-in Agent can use an Anthropic API Key, or you can sign in with a Claude subscription on the Anthropic · Claude Code page below (no API Key required).'
        + 'Standalone Claude Code sessions can also drive AfterFrame via External Agent Access (MCP).'
      : 'Each provider saves its address, key, and model independently. Test the connection first; once successful, select from the models returned by the API.',
    ...(preset.id === 'anthropic'
      ? { noteAction: { label: 'External Agent integration (MCP)', action: 'open-mcp-guide' } }
      : {}),
    fields: [
      {
        name: names.baseUrl,
        label: 'API URL',
        kind: 'text',
        defaultLabel: preset.baseUrl,
        note: 'Enter the full API prefix; use the official URL, a self-hosted gateway, or a compatible relay.',
      },
      secret(names.apiKey, isLocalLlmProvider(preset.id) ? 'API Key (optional)' : 'API Key'),
      ...(preset.id === 'openai' ? [{
        name: 'LLM_OPENAI_API_MODE',
        label: 'API format',
        kind: 'select' as const,
        defaultLabel: 'Responses API (Recommended)',
        note: 'Choose the protocol the service actually supports; OpenAI uses the Responses API, while compatible services use the Chat Completions API.',
        options: [{ value: 'chat', label: 'Chat Completions API' }],
      }] : []),
      {
        name: names.model,
        label: 'Model',
        kind: 'text',
        defaultLabel: preset.defaultModel,
        discoverableModel: true,
        note: 'After testing the connection, select a model returned by the API or enter a model ID manually.',
        options: [{ value: preset.defaultModel, label: preset.defaultModel }],
      },
    ],
  };
};

const CODEX_PAGE: SettingsVendorPage = {
  key: 'llm/codex',
  vendor: 'openai',
  title: 'OpenAI · Codex',
  connection: 'codex',
  note: 'Sign in with a ChatGPT subscription; the official Codex CLI manages credentials, renewal, and sign-out. AfterFrame does not read or display OAuth credentials.',
  fields: [
    {
      name: 'CODEX_MODEL', label: 'Codex model', kind: 'text',
      defaultLabel: 'Codex default model', discoverableModel: true,
      note: 'Sign in to load available models for this account, or enter a model ID manually.',
    },
    {
      name: 'CODEX_REASONING_EFFORT', label: 'Reasoning effort', kind: 'select',
      options: [{ value: '', label: 'Model default' }],
      note: 'After model load, shows supported tiers for the current model; leave blank to use its default.',
    },
  ],
};

const COPILOT_PAGE: SettingsVendorPage = {
  key: 'llm/copilot',
  vendor: 'copilot',
  title: 'GitHub Copilot',
  connection: 'copilot',
  note: 'Use a GitHub Copilot subscription: the official Copilot CLI manages sign-in and credentials (run copilot login in the terminal),'
    + 'AfterFrame drives editing tools directly via the Copilot SDK and does not read or display credentials.'
    + 'Session state is isolated in ~/.afterframe/copilot and does not affect your own ~/.copilot.',
  fields: [
    {
      name: 'COPILOT_MODEL', label: 'Copilot model', kind: 'text',
      defaultLabel: 'Copilot default model', discoverableModel: true,
      note: 'After signing in, you can read models available to your current subscription or manually enter a model ID. Only models that support tool calls can be used for editing.',
    },
    {
      name: 'COPILOT_REASONING_EFFORT', label: 'Reasoning effort', kind: 'select',
      options: [{ value: '', label: 'Model default' }],
      note: 'After model load, shows supported tiers for the current model; leave blank to use its default.',
    },
  ],
};

const CLAUDE_CODE_PAGE: SettingsVendorPage = {
  key: 'llm/claude-code',
  vendor: 'anthropic',
  title: 'Anthropic · Claude Code',
  connection: 'claude-code',
  note: 'Sign in with a Claude subscription; the official Claude Code CLI manages credentials, renewal, and sign-out. AfterFrame does not read or display OAuth credentials.'
    + 'Run claude auth login in the terminal (or claude setup-token for a long-lived token), then click “Recheck”.',
  fields: [
    {
      name: 'CLAUDE_CODE_MODEL', label: 'Claude Code model', kind: 'text',
      defaultLabel: 'Claude Code default model', discoverableModel: true,
      note: 'After signing in, choose from available models or manually enter an alias (e.g., sonnet / opus / haiku).',
    },
  ],
};

const XAI_OAUTH_PAGE: SettingsVendorPage = {
  key: 'llm/xai-oauth', vendor: 'xai-oauth', title: 'xAI · Grok (subscription login)',
  connection: 'xai-oauth',
  note: 'Sign in with a SuperGrok or X Premium+ subscription: the official Grok CLI manages login and credentials (run grok login in a terminal). AfterFrame imports the session and renews it automatically; it does not read or display OAuth credentials.',
  fields: [{
    name: 'LLM_XAI_OAUTH_MODEL', label: 'Model', kind: 'text', defaultLabel: 'grok-4.6',
    discoverableModel: true,
    note: 'After testing the connection, select a model returned by the API or enter a model ID manually.',
    options: [{ value: 'grok-4.6', label: 'grok-4.6' }],
  }],
};

// Sponsored placement: OFox sits 4th in Agent  (Anthropic, OpenAI,
// OpenAI · Codex, OFox), independent of its position in LLM_PROVIDER_PRESETS.
const OFOX_PRESET = LLM_PROVIDER_PRESETS.find((preset) => preset.id === 'ofox');
const AGENT_VENDOR_PAGES: readonly SettingsVendorPage[] = LLM_PROVIDER_PRESETS.flatMap((preset) => {
  if (preset.id === 'xai-oauth') return [XAI_OAUTH_PAGE];
  if (preset.id === 'ofox') return [];
  const page = llmPage(preset);
  if (preset.id === 'anthropic') return [page, CLAUDE_CODE_PAGE];
  if (preset.id !== 'openai') return [page];
  return OFOX_PRESET
    ? [page, CODEX_PAGE, llmPage(OFOX_PRESET), COPILOT_PAGE]
    : [page, CODEX_PAGE, COPILOT_PAGE];
});

const VISION_PAGE: SettingsVendorPage = {
  key: 'llm/vision', vendor: 'vision', title: 'Visual understanding', fields: [],
};

export const PROXY_PAGE: SettingsVendorPage = {
  key: 'agent/proxy', vendor: 'proxy', title: 'Network proxy', kind: 'settings',
  note: 'When domestic network access to overseas models (Gemini / OpenAI / Anthropic / Mistral, etc.) fails,'
    + 'Enter a local proxy address here (e.g. http://127.0.0.1:7890).'
    + 'Leave blank to use system environment variables (HTTPS_PROXY / HTTP_PROXY).'
    + 'Applies to: Agent models, AI generation, model downloads, R2 cloud sync.',
  fields: [text('PROXY_URL', 'Proxy address', 'e.g. http://127.0.0.1:7890')],
};

export const AGENT_VENDOR_PAGES_WITH_VISION: readonly SettingsVendorPage[] = [
  ...AGENT_VENDOR_PAGES,
  VISION_PAGE,
];
