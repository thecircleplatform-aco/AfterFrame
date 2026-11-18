import type { ModelMessage } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type { AgentToolSchema } from './tool-schema';
import { hasMutationRoutingIntent, routedToolSelection } from './tool-routing';
import { activatedToolNamesForResult } from './skills/skill-tool-activation';

const BOOT_TOOL_NAMES: Record<string, true> = {
  ToolSearch: true,
  load_skill: true,
  read_project: true,
  read_timeline: true,
  ask_followup_questions: true,
  // Plan mode's only output channel; gating it behind tool search would leave
  // the model with nothing to call after investigating.
  propose_plan: true,
  report_user_friction: true,
  read_agent_artifact: true,
  // Vision. The system prompt requires verifying visual edits with a rendered
  // frame ("Do not infer media contents from filenames or report visual quality
  // from imagination"), but these were only reachable through ToolSearch or a
  // narrow keyword route. A model told to verify its work while unable to see
  // anything will either skip verification or invent a description, so the
  // ability to look has to be available on every turn, not requested by name.
  view_timeline_frames: true,
  view_asset_frames: true,
  // Missing local tooling is a dead end the model cannot reason its way out of.
  // Keeping the check on every turn means the agent diagnoses instead of telling
  // the user to run a terminal command; the install half still needs approval.
  ensure_dependencies: true,
};

// Phrases that mean "look, don't touch". These gate whether the mutating
// routing groups are allowed at all, so a missing language does not merely lose
// precision — it hands editing tools to a user who explicitly asked for a
// read-only answer. Kept in the user's own language rather than relying on the
// English list plus translation.
const READ_ONLY_TERMS = [
  'Do not modify', 'Do not edit', 'Read-only',
  'read only', 'read-only', 'do not edit', "don't edit", 'without editing',
  // 中文
  '不要修改', '不要编辑', '不要改动', '别修改', '别改', '只读', '只查看', '只告诉我', '仅查看', '不修改', '不要动',
  // 日本語
  '変更しないで', '編集しないで', '修正しないで', '見るだけ', '読み取り専用',
  // 한국어
  '수정하지 마', '편집하지 마', '변경하지 마', '읽기 전용', '보기만',
  // Русский
  'не изменять', 'не редактировать', 'только посмотреть', 'только чтение',
  // Español / Français / Deutsch / Português / Italiano
  'no modificar', 'no editar', 'solo lectura', 'sin editar',
  'ne pas modifier', 'ne pas éditer', 'lecture seule', 'sans modifier',
  'nicht ändern', 'nicht bearbeiten', 'nur lesen', 'schreibgeschützt',
  'não modificar', 'não editar', 'somente leitura', 'sem editar',
  'non modificare', 'non modificare nulla', 'solo lettura', 'senza modificare',
  // ไทย / हिन्दी / العربية
  'ห้ามแก้ไข', 'ไม่ต้องแก้ไข', 'อ่านเท่านั้น', 'ดูเท่านั้น',
  'बदलें नहीं', 'संपादित न करें', 'केवल पढ़ें', 'सिर्फ देखें',
  'لا تعدل', 'لا تحرر', 'للقراءة فقط', 'اعرض فقط',
];

/** A natural-language hint may narrow initial routing, but never becomes tool authority. */
function isReadOnlyRoutingHint(request: string): boolean {
  let remainder = request.toLowerCase();
  let matched = false;
  for (const term of READ_ONLY_TERMS) {
    if (!remainder.includes(term)) continue;
    matched = true;
    remainder = remainder.split(term).join('');
  }
  return matched && !hasMutationRoutingIntent(remainder);
}


function textFromMessage(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content.flatMap((part) => {
    if (!part || typeof part !== 'object' || !('text' in part)) return [];
    return typeof part.text === 'string' ? [part.text] : [];
  }).join(' ');
}

function latestUserText(messages: readonly ModelMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return textFromMessage(messages[index]).toLowerCase();
  }
  return '';
}
function bootNames(): string[] {
  return Object.keys(BOOT_TOOL_NAMES);
}

function collectActivatedNames(value: unknown, names: string[]): void {
  if (typeof value === 'string') {
    try { collectActivatedNames(JSON.parse(value), names); } catch { /* not JSON */ }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if ('activatedTools' in value && Array.isArray(value.activatedTools)) {
    for (const name of value.activatedTools) if (typeof name === 'string') names.push(name);
  }
  if ('value' in value && value.value !== undefined) collectActivatedNames(value.value, names);
}
export function activatedToolNamesFromResult(value: unknown): string[] {
  const names: string[] = [];
  collectActivatedNames(value, names);
  return [...new Set(names)];
}

function isActivationCheckpoint(message: ModelMessage): boolean {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return false;
  return message.content.some((part) => {
    if (!part || typeof part !== 'object' || !('providerOptions' in part)) return false;
    const options = part.providerOptions;
    if (!options || typeof options !== 'object' || !('afterframe' in options)) return false;
    const names: string[] = [];
    collectActivatedNames(options.afterframe, names);
    return names.length > 0;
  });
}

function activationScanStart(messages: readonly ModelMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'assistant' || isActivationCheckpoint(message)) continue;
    if (typeof message.content === 'string' && message.content.trim()) return index + 1;
    if (Array.isArray(message.content) && message.content.some((part) => (
      part && typeof part === 'object' && 'type' in part && part.type === 'text'
        && 'text' in part && typeof part.text === 'string' && part.text.trim()
    ))) return index + 1;
  }
  return 0;
}

export function activationProviderOptions(names: readonly string[]): ProviderOptions | undefined {
  const activatedTools = [...new Set(names)];
  return activatedTools.length ? { afterframe: { activatedTools } } : undefined;
}

export function activatedToolNamesFromMessages(messages: readonly ModelMessage[]): string[] {
  const names: string[] = [];
  for (const message of messages.slice(activationScanStart(messages))) {
    if (message.role === 'user' || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (!part || typeof part !== 'object') continue;
      if ('providerOptions' in part) {
        const options = part.providerOptions;
        if (options && typeof options === 'object' && 'afterframe' in options) {
          collectActivatedNames(options.afterframe, names);
        }
      }
      if (!('type' in part) || part.type !== 'tool-result') continue;
      if (!('toolName' in part) || part.toolName !== 'ToolSearch' || !('output' in part)) continue;
      names.push(...activatedToolNamesFromResult(part.output));
    }
  }
  return [...new Set(names)];
}
function routedNames(
  catalog: readonly AgentToolSchema[],
  messages: readonly ModelMessage[],
): { readonly names: string[]; readonly overflow: boolean } {
  const request = latestUserText(messages);
  if (!request) return { names: [], overflow: false };
  const routed = routedToolSelection(request, isReadOnlyRoutingHint(request));
  return {
    names: catalog.filter((schema) => routed.names.has(schema.name)).map((schema) => schema.name),
    overflow: routed.overflow,
  };
}

export class ToolActivation {
  private readonly activeNames: ReadonlySet<string>;
  private readonly byName: ReadonlyMap<string, AgentToolSchema>;
  private readonly catalog: readonly AgentToolSchema[];

  constructor(
    catalog: readonly AgentToolSchema[],
    messages: readonly ModelMessage[],
    activeNames: Iterable<string> = [],
    allowSearch = true,
  ) {
    this.catalog = catalog;
    this.byName = new Map(catalog.map((schema) => [schema.name, schema]));
    const routed = routedNames(catalog, messages);
    const searchAllowed = allowSearch;
    const requested = [
      ...bootNames(),
      ...activatedToolNamesFromMessages(messages),
      ...routed.names,
      ...activeNames,
    ].filter((name) => searchAllowed || name !== 'ToolSearch');
    this.activeNames = new Set(requested.filter((name) => this.byName.has(name)));
  }

  withToolResult(toolName: string, result: unknown): {
    readonly activation: ToolActivation;
    readonly result: unknown;
  } {
    const activatedTools = activatedToolNamesForResult(toolName, result, this.catalog);
    const retainSearch = toolName === 'ToolSearch' || this.activeNames.has('ToolSearch');
    return {
      activation: new ToolActivation(
        this.catalog,
        [],
        [...this.activeNames, ...activatedTools],
        retainSearch,
      ),
      result: result && typeof result === 'object' && !Array.isArray(result)
        ? { ...result, activatedTools }
        : result,
    };
  }

  withSearchResult(result: unknown): {
    readonly activation: ToolActivation;
    readonly result: unknown;
  } {
    return this.withToolResult('ToolSearch', result);
  }

  schemas(): readonly AgentToolSchema[] {
    return this.catalog.filter((schema) => this.activeNames.has(schema.name));
  }

  allSchemas(): readonly AgentToolSchema[] {
    return this.catalog;
  }

  names(): readonly string[] {
    return this.schemas().map((schema) => schema.name);
  }

  /** Canonical-but-inactive call (model remembered a tool from history): activation
   * is a token optimization, not a security boundary, so admit and continue. */
  admit(name: string): ToolActivation {
    if (this.activeNames.has(name) || !this.byName.has(name)) return this;
    return new ToolActivation(
      this.catalog,
      [],
      [...this.activeNames, name],
      this.activeNames.has('ToolSearch'),
    );
  }
}
