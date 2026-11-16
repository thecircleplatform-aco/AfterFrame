export interface ProbeResult {
  ok: boolean;
  message: string;
  status?: number;
  latencyMs?: number;
  models?: string[];
}

export function parseModelCatalog(bodyText: string): string[] {
  try {
    const body = JSON.parse(bodyText) as {
      data?: Array<{ id?: unknown; name?: unknown }>;
      models?: Array<{ id?: unknown; name?: unknown }>;
    };
    const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
    return [...new Set(rows
      .map((row) => typeof row.id === 'string' ? row.id : typeof row.name === 'string' ? row.name : '')
      .map((id) => id.trim())
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Cheaper Inference also lists image/video models; chat keeps text and untyped rows. */
export function parseTextModelCatalog(bodyText: string): string[] {
  try {
    const body = JSON.parse(bodyText) as { data?: Array<{ type?: unknown } | null> };
    if (!Array.isArray(body.data)) return parseModelCatalog(bodyText);
    const data = body.data.filter((row) => row != null && (row.type === undefined || row.type === 'text'));
    return parseModelCatalog(JSON.stringify({ data }));
  } catch {
    return [];
  }
}

export function sanitizeProbeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}

/** MiniMax: HTTP 200 may also cause authentication failure, the truth is in base_resp.status_code(0 = success).*/
export function minimaxPostCheck(bodyText: string): string | null {
  try {
    const body = JSON.parse(bodyText) as { base_resp?: { status_code?: number; status_msg?: string } };
    const code = body.base_resp?.status_code ?? 0;
    if (code === 0) return null;
    const msg = body.base_resp?.status_msg ?? '';
    const hint = code === 1004 ? '(authentication failed — check the key)' : '';
    return `MiniMax base_resp ${code}${msg ? ` · ${sanitizeProbeText(msg)}` : ''}${hint}`;
  } catch {
    return null; // Non-JSON 2xx are counted as successful
  }
}

/** Doubao ：HTTP 200  code， 0  */
export function doubaoPostCheck(bodyText: string): string | null {
  try {
    const body = JSON.parse(bodyText) as { code?: number; message?: string };
    if (body.code == null || body.code === 0) return null;
    const hint = body.code === 401 || body.code === 403 ? '(authentication failed — check the API key)' : '';
    return `Doubao ${body.code}${body.message ? ` · ${sanitizeProbeText(body.message)}` : ''}${hint}`;
  } catch {
    return null; // Non-JSON 2xx are counted as successful
  }
}

/** Convert a provider response into a user-facing connectivity conclusion. */
export function classifyStatus(status: number, bodyText: string): ProbeResult {
  if (status === 401 || status === 403) {
    return { ok: false, status, message: `Authentication failed (HTTP ${status}) · the key is invalid, expired, or not allowed on this endpoint` };
  }
  if (status === 404) {
    return { ok: false, status, message: 'Probe endpoint returned 404 · the Base URL may be wrong, or this service does not expose that probe path' };
  }
  if (status === 429) {
    return { ok: true, status, message: 'Authentication passed (HTTP 429 rate limit — which means the key is valid)' };
  }
  const detail = sanitizeProbeText(bodyText);
  return { ok: false, status, message: `HTTP ${status}${detail ? ` · ${detail}` : ''}` };
}

/** Distinguish transport failures from rejected credentials. */
export function networkMessage(error: unknown): string {
  const raw = error instanceof Error
    ? `${error.name}: ${error.message}${error.cause instanceof Error ? `（${error.cause.message}）` : ''}`
    : String(error);
  if (/timeout|abort/i.test(raw)) {
    return 'Connection timed out · the service is unreachable or the network is restricted (a proxy may be needed). This does not mean the key is wrong';
  }
    return `Network unreachable · ${sanitizeProbeText(raw)} · this machine cannot reach the service (a proxy may be needed). This does not mean the key is wrong`;
}
