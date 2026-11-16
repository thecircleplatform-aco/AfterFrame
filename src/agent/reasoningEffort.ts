// Per-model reasoning-effort choice, shared by the composer picker and the
// request path.
//
// Effort is a property of the *model*, not a global setting (the same session may
// switch between a reasoning model and a plain one), so it is keyed by
// AgentModelChoice.id in localStorage. The request layer reads it at send time,
// which is what makes the picker take effect without a restart.
const STORAGE_KEY = 'cc.agent.reasoningEffort';

type EffortMap = Record<string, string>;

function read(): EffortMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

/** The saved effort for `modelId`, or undefined to keep the model's default. */
export function getReasoningEffort(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  return read()[modelId];
}

export function setReasoningEffort(modelId: string, effort: string): void {
  const next = { ...read(), [modelId]: effort };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

export function allReasoningEfforts(): EffortMap {
  return read();
}
