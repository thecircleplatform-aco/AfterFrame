// ensure_dependencies: let the agent provision its own missing local tooling.
//
// Until now a missing whisper.cpp binary or MediaPipe runtime ended the useful
// part of a run: the agent could only tell the user to run `npm run sync:…` in a
// terminal. This tool closes that loop — it reports what is missing and can
// start the pinned installer.
//
// Consent model: the INSTALL is gated by the approval UI, not by this code. The
// executor just makes the call; the harness refuses to run it until the user has
// approved the action card. That is the "user need to accept" half of the
// requirement, and it is enforced in one place rather than trusted here.
//
// Non-blocking: `install` awaits only long enough for the installer to START on
// the server (the request returns when the script finishes, but the tool caps how
// long it waits and reports "still running" so the run can continue). The user
// should not sit watching a 150 MB download before the agent says anything else.
import type { AgentContext } from '../context';

interface DependencyReport {
  readonly id: string;
  readonly label: string;
  readonly consequence: string;
  readonly status: 'ready' | 'missing' | 'partial';
  readonly detail: string;
  readonly installable: boolean;
  readonly approxBytes?: number;
  readonly note?: string;
}

interface DependencyListResponse {
  readonly dependencies?: DependencyReport[];
  readonly error?: string;
}

interface InstallResponse {
  readonly ok?: boolean;
  readonly id?: string;
  readonly already?: boolean;
  readonly output?: string;
  readonly error?: string;
}

/** How long `install` waits before handing control back to the model. */
const INSTALL_WAIT_MS = 4_000;

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function fetchReports(): Promise<DependencyReport[]> {
  const response = await fetch('/api/deps', { cache: 'no-store' });
  const body = await readJson<DependencyListResponse>(response);
  if (!response.ok || !body?.dependencies) {
    throw new Error(body?.error ?? `could not read dependency status (HTTP ${response.status})`);
  }
  return body.dependencies;
}

function summarize(reports: readonly DependencyReport[]): {
  missing: DependencyReport[];
  ready: DependencyReport[];
} {
  return {
    missing: reports.filter((entry) => entry.status !== 'ready'),
    ready: reports.filter((entry) => entry.status === 'ready'),
  };
}

function describe(entry: DependencyReport): Record<string, unknown> {
  return {
    id: entry.id,
    label: entry.label,
    status: entry.status,
    detail: entry.detail,
    ...(entry.installable ? { canInstall: true } : {}),
    ...(entry.note ? { note: entry.note } : {}),
  };
}

async function runCheck(): Promise<unknown> {
  const reports = await fetchReports();
  const { missing, ready } = summarize(reports);
  return {
    ok: missing.length === 0,
    ready: ready.map(describe),
    missing: missing.map(describe),
    guidance: missing.length === 0
      ? 'Everything needed is installed.'
      : 'For each missing entry with canInstall, call ensure_dependencies with action="install" and that id. The user will approve it once. Entries without canInstall must be handled by the user (see note), not by retrying.',
  };
}

async function runInstall(id: string): Promise<unknown> {
  const started = Date.now();
  // The request returns only when the installer finishes; racing it against a
  // short timer is what keeps the agent responsive. The install continues on the
  // server either way — this is not a cancellation.
  const install = fetch('/api/deps/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).then(async (response) => ({
    ok: response.ok,
    body: await readJson<InstallResponse>(response),
    status: response.status,
  })).catch((error: unknown) => ({
    ok: false,
    body: { error: error instanceof Error ? error.message : String(error) } as InstallResponse,
    status: 0,
  }));

  const raced = await Promise.race([
    install.then((value) => ({ settled: true as const, value })),
    new Promise<{ settled: false }>((resolve) => {
      setTimeout(() => resolve({ settled: false }), INSTALL_WAIT_MS);
    }),
  ]);

  if (!raced.settled) {
    return {
      ok: true,
      id,
      state: 'installing',
      note: `The installer for "${id}" is running in the background. It continues without blocking you. Check progress with action="check"; do not start it again.`,
    };
  }

  const { ok, body, status } = raced.value;
  if (!ok) {
    return {
      ok: false,
      id,
      error: body?.error ?? `install failed (HTTP ${status})`,
      output: body?.output ?? '',
    };
  }
  if (body?.already) {
    return { ok: true, id, state: 'already-installed', note: 'It was already present; nothing changed.' };
  }
  // Re-check so the model gets a verdict, not just an exit code.
  let reports: DependencyReport[] = [];
  try {
    reports = await fetchReports();
  } catch {
    // A failed re-check must not hide a successful install.
  }
  const after = reports.find((entry) => entry.id === id);
  return {
    ok: true,
    id,
    state: after?.status === 'ready' ? 'ready' : 'installed-but-unverified',
    elapsedMs: Date.now() - started,
    ...(after ? { status: describe(after) } : {}),
    ...(after?.status !== 'ready'
      ? { warning: 'The installer finished but the dependency still does not look ready. Read the output before retrying the original task.' }
      : {}),
    ...(body?.output ? { output: body.output.slice(-1200) } : {}),
  };
}

export async function execDependencyTool(
  name: string,
  args: Record<string, unknown>,
  _ctx: AgentContext,
): Promise<unknown> {
  if (name !== 'ensure_dependencies') return { error: `unknown tool ${name}` };
  const action = typeof args.action === 'string' ? args.action : 'check';

  try {
    if (action === 'check') return await runCheck();

    if (action === 'install') {
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id) {
        return { error: 'action="install" requires id. Call action="check" first to see which ids are missing.' };
      }
      return await runInstall(id);
    }

    return { error: `unknown action "${action}" — use "check" or "install"` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
