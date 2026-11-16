// User-defined agents: a name, a system-prompt fragment and a tool scope.
// Stored locally (never synced) — these are personal presets, like Cursor's
// custom modes. Kept outside React state so the composer, the prompt builder and
// the settings dialog can all read the same snapshot.

export interface CustomAgent {
  readonly id: string;
  readonly name: string;
  /** Pasted instructions appended to the system prompt when this preset is active. */
  readonly prompt: string;
  /** `read` limits the turn to read-only tools, like Ask/Plan mode. */
  readonly readOnly: boolean;
  readonly createdAt: number;
}

const STORAGE_KEY = 'cc.customAgents.v1';
const MAX_AGENTS = 24;
const MAX_PROMPT_CHARS = 8000;

const listeners = new Set<() => void>();
let snapshot: CustomAgent[] = [];

function read(): CustomAgent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is CustomAgent => !!entry && typeof entry === 'object'
        && typeof (entry as CustomAgent).id === 'string'
        && typeof (entry as CustomAgent).name === 'string'
        && typeof (entry as CustomAgent).prompt === 'string')
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        prompt: entry.prompt,
        readOnly: entry.readOnly === true,
        createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0,
      }))
      .slice(0, MAX_AGENTS);
  } catch {
    return [];
  }
}

function write(next: CustomAgent[]): void {
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable: keep the in-memory snapshot so the session still works.
  }
  for (const listener of listeners) listener();
}

snapshot = read();

export function listCustomAgents(): CustomAgent[] {
  return snapshot;
}

export function subscribeCustomAgents(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function customAgent(id: string | null | undefined): CustomAgent | null {
  if (!id) return null;
  return snapshot.find((agent) => agent.id === id) ?? null;
}

export interface CustomAgentInput {
  readonly id?: string;
  readonly name: string;
  readonly prompt: string;
  readonly readOnly?: boolean;
}

/** Create or update a preset. Returns the stored agent, or null when the input is unusable. */
export function saveCustomAgent(input: CustomAgentInput): CustomAgent | null {
  const name = input.name.trim().slice(0, 40);
  const prompt = input.prompt.trim().slice(0, MAX_PROMPT_CHARS);
  if (!name || !prompt) return null;
  const existing = input.id ? snapshot.find((agent) => agent.id === input.id) : undefined;
  const agent: CustomAgent = {
    id: existing?.id ?? `agent_${crypto.randomUUID()}`,
    name,
    prompt,
    readOnly: input.readOnly ?? existing?.readOnly ?? false,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  write(existing
    ? snapshot.map((candidate) => (candidate.id === agent.id ? agent : candidate))
    : [agent, ...snapshot].slice(0, MAX_AGENTS));
  return agent;
}

export function deleteCustomAgent(id: string): void {
  write(snapshot.filter((agent) => agent.id !== id));
}

/** Test hook: replace the whole set (used by verify files). */
export function resetCustomAgents(next: CustomAgent[] = []): void {
  write(next.slice(0, MAX_AGENTS));
}
