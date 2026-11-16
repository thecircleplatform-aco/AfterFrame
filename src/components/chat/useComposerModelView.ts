import { useState, useSyncExternalStore } from 'react';
import { allReasoningEfforts, setReasoningEffort as setReasoningEffortChoice } from '../../agent/reasoningEffort';
import { useT } from '../../i18n/locale';
import type { AgentContextUsage } from '../../agent/context-compaction';
import {
  getAgentModelSnapshot,
  isAgentModelReady,
  subscribeAgentModels,
  type AgentModelChoice,
  type AgentModelSnapshot,
} from '../../agent/model-selection';

function compactTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) {
    const thousands = tokens / 1_000;
    return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
  }
  const millions = tokens / 1_000_000;
  return `${millions < 10 ? millions.toFixed(1) : Math.round(millions)}m`;
}

export interface ComposerModelView {
  readonly activeModel: AgentModelChoice | undefined;
  readonly contextLabel: string;
  readonly contextTitle: string;
  readonly contextNearLimit: boolean;
  readonly modelReady: boolean;
  readonly modelState: AgentModelSnapshot;
  /** Raw context numbers for the token-usage card (0 when the usage is for
   * another model, so a stale run is never attributed to this one). */
  readonly tokens: {
    readonly input: number;
    readonly cachedWrite: number;
    readonly cachedRead: number;
    readonly limit: number;
  };
  /** Current reasoning effort for the active model ('' / 'none' = disabled). */
  readonly reasoningEffort: string;
  readonly setReasoningEffort: (next: string) => void;
}

export function useComposerModelView(
  contextUsage: AgentContextUsage | null,
): ComposerModelView {
  const t = useT();
  const modelState = useSyncExternalStore(
    subscribeAgentModels,
    getAgentModelSnapshot,
    getAgentModelSnapshot,
  );
  const activeModel = modelState.choices.find((choice) => choice.id === modelState.activeId);
  // Match a usage record to the active model across execution endpoints.
  // Client-side runs stamp contextUsage.modelId with the AgentModelChoice.id
  // ("provider:model"); serverRun echoes model only ("claude-fable-5") because
  // its payload carries `model` (serverRunSend.ts) and the server stamps it
  // verbatim (server/agent-runs/context.ts). Compare identity leniently so the
  // "used / window" readout is correct whether the run executed in the browser
  // or on the server, without ever attributing another model's usage here.
  const usageModelId = contextUsage?.modelId ?? '';
  const usageMatchesModel = !!activeModel && (
    usageModelId === activeModel.id
    || usageModelId === `${activeModel.provider}:${activeModel.model}`
    || usageModelId === activeModel.model
  );
  const used = contextUsage && usageMatchesModel ? contextUsage.inputTokens : 0;
  const resolvedContext = activeModel?.capabilities.contextWindowTokens;
  const limit = contextUsage && usageMatchesModel
    ? contextUsage.contextWindowTokens
    : resolvedContext?.value ?? 0;
  const usedEstimated = !usageMatchesModel || contextUsage?.isEstimated !== false;
  const limitEstimated = usageMatchesModel
    ? contextUsage?.contextWindowEstimated !== false
    : resolvedContext?.estimated !== false;
  const contextNearLimit = limit > 0 && used / limit >= 0.65;
  const contextLabel = activeModel
    ? `${usedEstimated ? '~' : ''}${compactTokens(used)} / ${limitEstimated ? '~' : ''}${compactTokens(limit)}`
    : '';
  const breakdown = contextUsage && usageMatchesModel && contextUsage.systemTokens !== undefined
    ? t('System {system} · tools {tools} ({toolCount}) · history {history}', {
        system: `≈${compactTokens(contextUsage.systemTokens)}`,
        tools: `≈${compactTokens(contextUsage.toolSchemaTokens ?? 0)}`,
        toolCount: String(contextUsage.toolCount ?? 0),
        history: `≈${compactTokens(contextUsage.historyTokens ?? 0)}`,
      })
    : '';
  const cache = contextUsage && usageMatchesModel && contextUsage.cacheReadTokens !== undefined
    ? t('Cache read {tokens}', { tokens: compactTokens(contextUsage.cacheReadTokens) })
    : '';
  const contextSummary = activeModel
    ? t('Context: {used} / {limit}', {
        used: `${usedEstimated ? '≈' : ''}${compactTokens(used)}`,
        limit: `${limitEstimated ? '≈' : ''}${compactTokens(limit)}`,
      })
    : t('Choose model');
  const warning = contextNearLimit
    ? t('Context is near its limit; sending may compact earlier conversation.')
    : '';
  const contextTitle = [contextSummary, warning, breakdown, cache].filter(Boolean).join('\n');
  const [effortOverrides, setEffortOverrides] = useReasoningEffortOverride();
  const effortSupported = !!activeModel?.capabilities.supportsReasoning.value;
  const reasoningEffort = !effortSupported
    ? 'none'
    : effortOverrides[modelState.activeId] ?? activeModel?.reasoningEffort ?? 'none';
  const setReasoningEffort = (next: string): void => {
    if (!modelState.activeId) return;
    // Same store the request layer reads at send time (agent/reasoningEffort).
    setReasoningEffortChoice(modelState.activeId, next);
    setEffortOverrides(allReasoningEfforts());
  };
  return {
    activeModel,
    contextLabel,
    contextNearLimit,
    contextTitle,
    modelReady: isAgentModelReady(modelState),
    modelState,
    tokens: {
      input: used,
      cachedWrite: contextUsage && usageMatchesModel ? contextUsage.cacheWriteTokens ?? 0 : 0,
      cachedRead: contextUsage && usageMatchesModel ? contextUsage.cacheReadTokens ?? 0 : 0,
      limit,
    },
    reasoningEffort,
    setReasoningEffort,
  };
}

/**
 * Wraps the shared per-model store in component state so a toggle re-renders the
 * picker immediately. The store itself lives in `agent/reasoningEffort` because
 * the request path reads it at send time.
 */
function useReasoningEffortOverride(): [Record<string, string>, (next: Record<string, string>) => void] {
  const [overrides, setOverrides] = useState<Record<string, string>>(allReasoningEfforts);
  return [overrides, setOverrides];
}
