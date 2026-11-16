// Provider configuration page, field rendering, and connection tests.
import { useEffect, useMemo, useRef, useState } from 'react';
import { theme, themeAlpha } from '../../theme';
import { t, useT } from '../../i18n/locale';
import { VendorIcon } from './vendorIcons';
import type { VendorId } from './vendorIcons';
import { Icon } from '../../modules/icons';
import { CodexAccountCard } from './CodexAccountCard';
import type { CodexAgentModel } from '../../../shared/codex-agent';
import type { CodexSettingsController } from './useCodexSettings';
import { copilotReasoningOptions } from './copilotReasoning';
import type { CopilotSettingsController } from './useCopilotSettings';
import type { ClaudeCodeSettingsController } from './useClaudeCodeSettings';
import { ClaudeCodeVendorPane } from './ClaudeCodeVendorPane';
import { FalModelNote } from './FalModelNote';
import { shouldRenderModelPicker } from './codexReasoning';
import { llmProviderConfigNames, normalizeLlmProvider } from '../../../shared/llm-providers';
import { MODEL_CAPABILITY_OVERRIDES_KEY } from '../../../shared/model-capabilities';
import { CopilotVendorPane } from './CopilotVendorPane';
import { ModelCapabilityEditor } from './ModelCapabilityEditor';
import { XaiOauthVendorPane } from './XaiOauthVendorPane';
import { VisionModelPane } from './VisionModelPane';
import { LocalAsrPane } from './LocalAsrPane';
import { LocalModelPackPane } from './LocalModelPackPane';
import { SemanticModelPackPane } from './SemanticModelPackPane';
import { SettingsNoteAction } from './SettingsNoteAction.tsx';
import {
  fieldPlaceholder, isModelField, modelValue, selectOptionLabel, selectOptions, vendorConfigured,
  type KeyStatusResponse, type SelectOption, type SettingsField, type SettingsVendorPage,
  type StagedValues as Values,
} from './settingsSchema';
import {
  browseBtn, clearBtn, fieldCardBox, fieldHead, fieldHint, input, ON, pageNote,
  pane, select, sourceTag, testBtn, testMsg, testRow, WARN,
} from './settingsVendorPane.styles';
export { ON, WARN } from './settingsVendorPane.styles';

/**
 * Provider mark with a presence dot: green when the provider is configured,
 * red when it is not, blinking so the state reads at a glance without a line of
 * text underneath. The dot is a status badge, so it carries the label for
 * screen readers — the words are gone, the meaning is not.
 */
function ProviderMark({ vendor, on }: { vendor: VendorId; on: boolean }) {
  const x = useT();
  const label = on ? x('Configured') : x('Not configured');
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flex: '0 0 auto' }} role="img" aria-label={label} title={label}>
      <VendorIcon vendor={vendor} size={18} />
      <span
        className="cc-status-dot"
        data-on={on ? 'true' : 'false'}
        style={{ background: on ? theme.success : theme.danger }}
      />
    </span>
  );
}

/** Field rendering shared context: server status + temporary storage + plain text switch + temporary storage/clear callback. */
export interface FieldCtx {
  status: KeyStatusResponse | null;
  values: Values;
  reveal: boolean;
  onStage: (field: SettingsField, raw: string) => void;
  onToggleClear: (field: SettingsField) => void;
  modelOptions: Record<string, readonly string[]>;
  onModelsDiscovered: (name: string, models: readonly string[]) => void;
  codex: CodexSettingsController;
  copilot: CopilotSettingsController;
  claudeCode: ClaudeCodeSettingsController;
  /** Re-read /api/keys and push the result to the agent runtime (used by connection-style pages after login/logout). */
  refreshStatus: () => Promise<void>;
  /** Show another settings page, addressed by its vendor key (e.g. 'local/asr'). */
  openPage: (route: string) => void;
}
const CAPABILITY_OVERRIDE_FIELD: SettingsField = {
  name: MODEL_CAPABILITY_OVERRIDES_KEY, label: 'Model capabilities', kind: 'text', defaultLabel: '',
};

function capabilityOverridesValue(ctx: FieldCtx): string {
  return ctx.values[MODEL_CAPABILITY_OVERRIDES_KEY]
    ?? modelValue(ctx.status, MODEL_CAPABILITY_OVERRIDES_KEY);
}

function apiModelId(page: SettingsVendorPage, ctx: FieldCtx): string {
  const names = llmProviderConfigNames(page.vendor);
  const field = page.fields.find((candidate) => candidate.name === names.model);
  return (ctx.values[names.model] ?? modelValue(ctx.status, names.model)) || field?.defaultLabel || '';
}

// ──Provider configuration page ────────────────────────────────────────────────────────

export function VendorPane({ page, hint, ctx }: {
  page: SettingsVendorPage; hint: string; ctx: FieldCtx;
}) {
  const t = useT();
  // The model list is live endpoint data, not a fixed list: read it as soon as
  // the page opens so the picker is current without pressing "Test". Probing
  // once per page+field keeps this from firing on every render.
  const modelFieldName = page.fields.find((f) => f.discoverableModel)?.name ?? '';
  const knownModels = modelFieldName ? (ctx.modelOptions[modelFieldName]?.length ?? 0) : 0;
  const probedRef = useRef('');
  useEffect(() => {
    if (!modelFieldName || knownModels > 0) return;
    const identity = `${page.key}:${modelFieldName}`;
    if (probedRef.current === identity) return;
    probedRef.current = identity;
    let cancelled = false;
    void (async () => {
      try {
        const { body } = await requestProbe(page, ctx, t);
        if (!cancelled && body.ok && Array.isArray(body.models) && body.models.length > 0) {
          ctx.onModelsDiscovered(modelFieldName, body.models);
        }
      } catch {
        // Stay silent — the explicit "Test and read models" button reports errors.
      }
    })();
    return () => { cancelled = true; };
  }, [page.key, modelFieldName, knownModels]);
  if (page.connection === 'codex') return <CodexVendorPane page={page} hint={hint} ctx={ctx} />;
  if (page.connection === 'copilot') return (
    <CopilotVendorPane page={page} hint={hint} ctx={ctx} rawOverrides={capabilityOverridesValue(ctx)}
      onOverridesChange={(value) => ctx.onStage(CAPABILITY_OVERRIDE_FIELD, value)}>
      {page.fields.map((field) => <FieldRow key={field.name} field={field} ctx={ctx} />)}
    </CopilotVendorPane>
  );
  if (page.connection === 'claude-code') return (
    <ClaudeCodeVendorPane page={page} hint={hint} ctx={ctx} rawOverrides={capabilityOverridesValue(ctx)}
      onOverridesChange={(value) => ctx.onStage(CAPABILITY_OVERRIDE_FIELD, value)}>
      {page.fields.map((field) => <FieldRow key={field.name} field={field} ctx={ctx} />)}
    </ClaudeCodeVendorPane>
  );
  if (page.connection === 'xai-oauth') return <XaiOauthVendorPane page={page} hint={hint} ctx={ctx} />;
  if (page.key === 'llm/vision') return <VisionModelPane />;
  if (page.kind === 'local-models') return <LocalModelsPane page={page} fields={page.fields} ctx={ctx} />;
  const on = vendorConfigured(ctx.status, page, ctx.codex.status, ctx.copilot.status, ctx.claudeCode.status);
  return (
    <div style={pane}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ProviderMark vendor={page.vendor} on={on} />
          <b style={{ fontSize: 13 }}>{t(page.title)}</b>
        </div>
        <div style={{ fontSize: 11.5, color: theme.textDim, marginTop: 3, paddingLeft: 26 }}>{t(hint)}</div>
      </div>
      <section style={fieldCardBox}>
        {page.note && <div style={pageNote}>{t(page.note)}</div>}
        {page.noteAction && <SettingsNoteAction config={page.noteAction} onOpenPage={ctx.openPage} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: page.note ? 9 : 0 }}>
          {page.fields.map((f) => <FieldRow key={f.name} field={f} ctx={ctx} />)}
        </div>
        <FalModelNote page={page} status={ctx.status} values={ctx.values} />
        {page.key.startsWith('llm/') && (
          <ModelCapabilityEditor backend="api" provider={normalizeLlmProvider(page.vendor)}
            modelId={apiModelId(page, ctx)} rawOverrides={capabilityOverridesValue(ctx)}
            onChange={(value) => ctx.onStage(CAPABILITY_OVERRIDE_FIELD, value)} />
        )}
      </section>
      {page.vendor !== 'fal' && <TestConnectionRow page={page} ctx={ctx} />}
    </div>
  );
}

function CodexVendorPane({ page, hint, ctx }: {
  page: SettingsVendorPage; hint: string; ctx: FieldCtx;
}) {
  const t = useT();
  const status = ctx.codex.status;
  const statusLabel = !status ? t('Status unknown')
    : !status.installed ? t('CLI not installed')
      : status.loginPending || ctx.codex.login ? t('Signing in')
        : status.account?.type === 'chatgpt' ? t('Signed in')
          : status.account ? t('API key mode')
            : status.error || ctx.codex.error ? t('Connection problem') : t('Not signed in');
  const on = vendorConfigured(ctx.status, page, status);
  const capabilityModelId = (ctx.values.CODEX_MODEL ?? modelValue(ctx.status, 'CODEX_MODEL'))
    || ctx.codex.models.find((model) => model.isDefault)?.id
    || '';
  return (
    <div style={pane}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ProviderMark vendor={page.vendor} on={on} />
          <b style={{ fontSize: 13 }}>{t(page.title)}</b>
          <span style={{ fontSize: 11, color: theme.textDim }}>{statusLabel}</span>
        </div>
        <div style={{ fontSize: 11.5, color: theme.textDim, marginTop: 3, paddingLeft: 26 }}>{t(hint)}</div>
      </div>
      <CodexAccountCard controller={ctx.codex} />
      <section style={fieldCardBox}>
        {page.note && <div style={pageNote}>{t(page.note)}</div>}
        {page.noteAction && <SettingsNoteAction config={page.noteAction} onOpenPage={ctx.openPage} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: page.note ? 9 : 0 }}>
          {page.fields.map((field) => <FieldRow key={field.name} field={field} ctx={ctx} />)}
        </div>
        {capabilityModelId && (
          <ModelCapabilityEditor backend="codex" provider="openai"
            modelId={capabilityModelId}
            rawOverrides={capabilityOverridesValue(ctx)}
            onChange={(value) => ctx.onStage(CAPABILITY_OVERRIDE_FIELD, value)} />
        )}
      </section>
    </div>
  );
}

function LocalModelsPane({ page, fields, ctx }: {
  page: SettingsVendorPage; fields: readonly SettingsField[]; ctx: FieldCtx;
}) {
  const t = useT();
  const title = page.key === 'local/asr' ? 'Local transcription' : page.key === 'local/music/packs' ? 'Beat and music analysis' : 'Visual semantic search';
  return (
    <div style={pane}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {page.icon ? <Icon name={page.icon} size={18} /> : <VendorIcon vendor={page.vendor} size={18} />}
          <b style={{ fontSize: 13 }}>{t(title)}</b>
        </div>
        <div style={{ fontSize: 11.5, color: theme.textDim, marginTop: 3, paddingLeft: 26 }}>
          {t('Local models install on demand; indexing, transcription and analysis all run on this machine.')}
        </div>
      </div>
      {page.key === 'local/asr' && <LocalAsrPane fields={fields} ctx={ctx} />}
      {page.key === 'local/music/packs' && <LocalModelPackPane
        packIds={['rhythm-lite', 'music-semantics-lite']}
        title="Beat and music analysis models"
        description="Models are never installed automatically. Once installed, beat and music-embedding analysis runs entirely on this machine." />}
      {page.key === 'local/semantic/setup' && <SemanticModelPackPane />}
    </div>
  );
}

// ── Test connection ───────────────────────────────────────────────────────

interface ProbeRequestResult { body: ProbeResponse; staged: boolean; }
interface ProbeResponse { ok: boolean; message: string; latencyMs?: number; models?: string[]; }
interface ProbeShown { page: string; ok: boolean; message: string; }

/** Unsaved temporary values in the fields on this page → detect overrides; the empty string represents the default value for this test. */
function stagedOverrides(page: SettingsVendorPage, values: Values): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const f of page.fields) {
    const v = values[f.name];
    if (v !== undefined) overrides[f.name] = v.trim();
  }
  return overrides;
}

async function requestProbe(page: SettingsVendorPage, ctx: FieldCtx, translate: typeof t): Promise<ProbeRequestResult> {
  const overrides = stagedOverrides(page, ctx.values);
  if (page.kind === 'settings' && page.fields[0]) {
    const field = page.fields[0];
    const effectiveValue = ctx.values[field.name] ?? modelValue(ctx.status, field.name);
    if (effectiveValue?.trim()) overrides[field.name] = effectiveValue.trim();
    else delete overrides[field.name];
  }
  const staged = Object.keys(ctx.values).some((name) => page.fields.some((field) => field.name === name));
  const res = await fetch('/api/keys/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: page.key, overrides }),
  });
  const body = await res.json().catch(() => null) as ProbeResponse | null;
  if (!body || typeof body.message !== 'string') throw new Error(translate('Test request failed ({n})', { n: res.status }));
  return { body, staged };
}

export function TestConnectionRow({ page, ctx }: { page: SettingsVendorPage; ctx: FieldCtx }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeShown | null>(null);
  const shown = result && result.page === page.key ? result : null;

  const test = async (): Promise<void> => {
    setBusy(true); setResult(null);
    try {
      const { body, staged } = await requestProbe(page, ctx, t);
      const suffix = staged && body.ok ? t('(tested with the current input — remember to save)') : '';
      setResult({ page: page.key, ok: body.ok, message: t(body.message) + suffix });
      const modelField = page.fields.find((field) => field.discoverableModel);
      if (body.ok && modelField && Array.isArray(body.models)) {
        ctx.onModelsDiscovered(modelField.name, body.models);
      }
    } catch (err) {
      setResult({ page: page.key, ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const discoversModels = page.fields.some((field) => field.discoverableModel);
  const isProxy = page.key === 'agent/proxy';
  return (
    <div style={testRow}>
      <button type="button" onClick={() => { void test(); }} disabled={busy}
        style={{ ...testBtn, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? t('Testing…') : discoversModels ? t('Test and read models') : isProxy ? t('Test proxy connection') : t('Test connection')}
      </button>
      {shown && (
        <span style={{ ...testMsg, color: shown.ok ? ON : WARN }} title={shown.message}>
          {shown.ok ? '✓ ' : '✗ '}{shown.message}
        </span>
      )}
      {!shown && !busy && (
        <span style={{ ...testMsg, color: theme.textDim }}>
          {discoversModels
            ? t('Validates the address and key, then reads the models this endpoint offers')
            : isProxy ? t('Uses the current proxy address to reach the internet probe endpoint') : t('Sends one minimal request to check the key and address work')}
        </span>
      )}
    </div>
  );
}

// ──Field rendering ────────────────────────────────────────────────────────

function selectedCodexModel(ctx: FieldCtx): CodexAgentModel | undefined {
  const selectedId = ctx.values.CODEX_MODEL ?? modelValue(ctx.status, 'CODEX_MODEL');
  return ctx.codex.models.find((model) => model.id === selectedId)
    ?? (selectedId ? undefined : ctx.codex.models.find((model) => model.isDefault));
}

function codexReasoningOptions(
  ctx: FieldCtx,
  formatDefault: (effort?: string) => string,
): readonly SelectOption[] {
  const model = selectedCodexModel(ctx);
  return [
    { value: '', label: formatDefault(model?.defaultReasoningEffort ?? undefined) },
    ...(model?.supportedReasoningEfforts.map((option) => ({
      value: option.reasoningEffort,
      label: option.reasoningEffort,
    })) ?? []),
  ];
}

export function FieldRow({ field, ctx }: { field: SettingsField; ctx: FieldCtx }) {
  const t = useT();
  const { status, reveal, onStage, onToggleClear } = ctx;
  // value: undefined = no temporary changes; '' = temporary cache clear / return to default; the rest = temporary new values.
  const value = ctx.values[field.name];
  const st = status?.keys[field.name];
  const configured = Boolean(st?.configured);
  const stagedClear = value === '' && field.kind !== 'toggle';
  // Model / routing field echoes the current value of the server; secret / base url will never be backfilled.
  const shown = value ?? (isModelField(field) ? modelValue(status, field.name) : '');
  // Select uses the "default" option to clear; toggle's off/on itself is set/clear.
  const clearable = configured && field.kind !== 'select' && field.kind !== 'toggle';
  const discovered = field.name === 'CODEX_MODEL'
    ? ctx.codex.models.map((model) => model.id)
    : field.name === 'COPILOT_MODEL'
      ? ctx.copilot.models.filter((model) => model.supportsTools).map((model) => model.id)
      : field.name === 'CLAUDE_CODE_MODEL'
        ? ctx.claudeCode.models.map((model) => model.id)
        : field.discoverableModel ? ctx.modelOptions[field.name] ?? [] : [];
  const options = field.name === 'CODEX_REASONING_EFFORT'
    ? codexReasoningOptions(ctx, (effort) => effort
      ? t('Model default ({name})', { name: effort })
      : t('Model default'))
    : field.name === 'COPILOT_REASONING_EFFORT'
      ? copilotReasoningOptions(ctx, t('Model default'))
      : undefined;
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={fieldHead}>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
          {t(field.label)}
          {configured && <span style={sourceTag}>{st?.source === 'env' ? '.env.local' : t('This session')}</span>}
        </span>
        {clearable && (
          <button type="button" onClick={(e) => { e.preventDefault(); onToggleClear(field); }}
            style={{ ...clearBtn, color: stagedClear ? WARN : theme.textDim }}>
            {stagedClear ? t('Cancel clear') : t('Clear')}
          </button>
        )}
      </span>
      {field.kind === 'toggle'
        ? <ToggleSwitch field={field} shown={shown} onStage={onStage} />
        : shouldRenderModelPicker(field, discovered.length)
          ? <ModelInput field={field} shown={shown} models={discovered} reveal={reveal}
              loading={(field.name === 'CODEX_MODEL' && ctx.codex.modelBusy)
                || (field.name === 'COPILOT_MODEL' && ctx.copilot.modelBusy)
                || (field.name === 'CLAUDE_CODE_MODEL' && ctx.claudeCode.modelBusy)}
              configured={configured} stagedClear={stagedClear} onStage={onStage} />
          : field.kind === 'select'
          ? <SelectInput field={field} status={status} shown={shown} options={options} onStage={onStage} />
          : field.kind === 'directory'
            ? <DirectoryInput field={field} shown={shown} stagedClear={stagedClear} onStage={onStage} />
            : <TextInput field={field} shown={shown} reveal={reveal} configured={configured}
                stagedClear={stagedClear} onStage={onStage} />}
      {field.note && <span style={{ fontSize: 10.5, color: theme.textDim }}>{t(field.note)}</span>}
    </label>
  );
}

function ModelInput({ field, shown, models, reveal, loading, configured, stagedClear, onStage }: {
  field: SettingsField;
  shown: string;
  models: readonly string[];
  reveal: boolean;
  loading?: boolean;
  configured: boolean;
  stagedClear: boolean;
  onStage: (field: SettingsField, raw: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 7 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TextInput field={field} shown={shown} reveal={reveal} configured={configured}
          stagedClear={stagedClear} onStage={onStage} />
      </div>
      <ModelPicker models={models} loading={loading} onPick={(model) => onStage(field, model)} />
    </div>
  );
}

/**
 * Model picker. A native <select> paints the OS popup — a white box on a dark
 * glass panel — so this is a listbox that matches the rest of the sheet: glass
 * trigger, floating menu, search filter once the list is long enough.
 */
function ModelPicker({ models, loading, onPick }: {
  models: readonly string[]; loading?: boolean; onPick: (model: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  useEffect(() => { if (!open) setFilter(''); }, [open]);

  const all = useMemo(() => [...new Set(models)], [models]);
  const needle = filter.trim().toLowerCase();
  const list = needle === '' ? all : all.filter((model) => model.toLowerCase().includes(needle));
  const disabled = all.length === 0;
  return (
    <div ref={boxRef} style={{ position: 'relative', flex: '0 0 auto' }}>
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen((value) => !value); }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={loading === true}
        aria-label={t('Choose model')}
        title={t('Choose model')}
        style={{
          ...select, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 6, width: 118, flex: '0 0 118px', opacity: disabled ? 0.55 : 1,
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loading ? t('Reading…') : t('Choose model')}
        </span>
        <span style={{ display: 'inline-flex', flex: '0 0 auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .16s ease' }}>
          <Icon name="chevronDown" size={12} />
        </span>
      </button>
      {open && (
        <div role="listbox" aria-label={t('Choose model')} style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40,
          width: 232, maxHeight: 244, display: 'flex', flexDirection: 'column', gap: 2,
          padding: 6, borderRadius: 14, background: theme.panel,
          border: `0.5px solid ${theme.border}`,
          boxShadow: `0 20px 48px ${themeAlpha.shadow(0.6)}`,
          backdropFilter: 'blur(18px) saturate(1.3)',
        }}>
          {all.length > 6 && (
            <input
              autoFocus value={filter} onChange={(event) => setFilter(event.target.value)}
              placeholder={t('Filter models')} aria-label={t('Filter models')}
              style={{
                font: 'inherit', fontSize: 11.5, border: 'none', outline: 'none',
                background: themeAlpha.ink(0.06), color: theme.text,
                borderRadius: 8, padding: '6px 8px', marginBottom: 3,
              }}
            />
          )}
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {list.map((model) => (
              <button
                key={model}
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => { onPick(model); setOpen(false); }}
                onMouseEnter={() => setHovered(model)}
                onMouseLeave={() => setHovered((current) => (current === model ? null : current))}
                style={{
                  font: 'inherit', fontSize: 11.5, textAlign: 'left', padding: '6px 8px',
                  borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: hovered === model ? themeAlpha.ink(0.1) : 'transparent',
                  color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {model}
              </button>
            ))}
            {list.length === 0 && (
              <span style={{ fontSize: 11.5, color: theme.textDim, padding: '6px 8px' }}>
                {t('No models')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Switch field:''/Anything other than '0' = enabled (default), '0' = disabled. On = temporary storage ''(clear key to return to default),
 * Off = Temporary storage '0' - The semantics are naturally consistent with the "'' explicit clear" of buildPatch, and it will take effect immediately after saving. */
function ToggleSwitch({ field, shown, onStage }: {
  field: SettingsField; shown: string;
  onStage: (field: SettingsField, raw: string) => void;
}) {
  const t = useT();
  const on = shown !== '0';
  return (
    <button
      type="button" role="switch" aria-checked={on}
      onClick={(e) => { e.preventDefault(); onStage(field, on ? '0' : ''); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
        font: 'inherit', fontSize: 11.5, color: on ? ON : theme.textDim,
        background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
      }}
    >
      <span aria-hidden style={{
        width: 30, height: 17, borderRadius: 999, position: 'relative', flexShrink: 0,
        background: on ? ON : theme.border, transition: 'background .18s ease',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 15 : 2, width: 13, height: 13,
          borderRadius: '50%', background: theme.textStrong, transition: 'left .18s ease',
          boxShadow: `0 1px 3px ${themeAlpha.shadow(0.4)}`,
        }} />
      </span>
      {on ? t('Enabled') : t('Disabled')}
    </button>
  );
}

interface TextInputProps {
  field: SettingsField; shown: string; reveal: boolean; configured: boolean; stagedClear: boolean;
  onStage: (field: SettingsField, raw: string) => void;
}

function TextInput({ field, shown, reveal, configured, stagedClear, onStage }: TextInputProps) {
  const listId = field.kind === 'text' && field.options ? `cc-dl-${field.name}` : undefined;
  const displayValue = stagedClear ? shown : shown || field.defaultValue || '';
  return (
    <>
      <input
        type={field.kind === 'secret' && !reveal ? 'password' : 'text'}
        autoComplete="off" spellCheck={false} list={listId}
        value={displayValue}
        onChange={(e) => onStage(field, e.target.value)}
        placeholder={fieldPlaceholder(field, configured, stagedClear)}
        style={stagedClear ? { ...input, border: `0.5px solid ${WARN}` } : input}
      />
      {listId && (
        <datalist id={listId}>
          {field.options?.map((o) => <option key={o.value} value={o.value} />)}
        </datalist>
      )}
    </>
  );
}

function DirectoryInput({ field, shown, stagedClear, onStage }: {
  field: SettingsField; shown: string; stagedClear: boolean;
  onStage: (field: SettingsField, raw: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = window.AfterFrameDesktop?.selectDirectory;
  const pick = async (): Promise<void> => {
    if (!picker) return;
    setBusy(true); setError(null);
    try {
      const selected = await picker(shown || undefined);
      if (selected) onStage(field, selected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Cannot open the directory picker'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 7 }}>
        <input type="text" autoComplete="off" spellCheck={false} value={shown}
          onChange={(e) => onStage(field, e.target.value)}
          placeholder={fieldPlaceholder(field, false, stagedClear)}
          style={{ ...(stagedClear ? { ...input, border: `0.5px solid ${WARN}` } : input), minWidth: 0 }} />
        <button type="button" onClick={(e) => { e.preventDefault(); void pick(); }}
          disabled={!picker || busy} title={!picker ? t('The directory picker is only available on desktop') : t('Choose where media is saved')}
          style={{ ...browseBtn, opacity: !picker || busy ? 0.55 : 1 }}>
          {busy ? t('Choosing…') : t('Choose directory')}
        </button>
      </div>
      {!picker && <span style={fieldHint}>{t('The directory picker is only available on desktop; in the browser, type an absolute path.')}</span>}
      {error && <span style={{ ...fieldHint, color: WARN }}>{error}</span>}
    </>
  );
}

/**
 * Glass listbox used instead of a native <select>, which would paint the OS
 * popup (a white box) on top of the dark sheet. Same trigger/metrics as the
 * native control so layouts do not shift.
 */
function GlassSelect({ value, options, onChange, label }: {
  value: string; options: readonly { value: string; label: string }[];
  onChange: (value: string) => void; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const selected = options.find((option) => option.value === value);
  return (
    <div ref={boxRef} style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
      <button
        type="button" onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox" aria-expanded={open} aria-label={label} title={label}
        style={{
          ...select, width: '100%', flex: '1 1 auto',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected?.label ?? value}
        </span>
        <span style={{ display: 'inline-flex', flex: '0 0 auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .16s ease' }}>
          <Icon name="chevronDown" size={12} />
        </span>
      </button>
      {open && (
        <div role="listbox" aria-label={label} style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 40,
          minWidth: '100%', maxHeight: 244, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 1,
          padding: 6, borderRadius: 14, background: theme.panel,
          border: `0.5px solid ${theme.border}`,
          boxShadow: `0 20px 48px ${themeAlpha.shadow(0.6)}`,
          backdropFilter: 'blur(18px) saturate(1.3)',
        }}>
          {options.map((option) => (
            <button
              key={option.value || '∅'}
              type="button" role="option" aria-selected={option.value === value}
              onClick={() => { onChange(option.value); setOpen(false); }}
              onMouseEnter={() => setHovered(option.value)}
              onMouseLeave={() => setHovered((current) => (current === option.value ? null : current))}
              style={{
                font: 'inherit', fontSize: 11.5, textAlign: 'left', padding: '7px 9px',
                borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                background: option.value === value
                  ? themeAlpha.ink(0.14)
                  : hovered === option.value ? themeAlpha.ink(0.1) : 'transparent',
                color: option.value === value ? theme.textStrong : theme.text,
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SelectInput({ field, status, shown, options, onStage }: {
  field: SettingsField; status: KeyStatusResponse | null; shown: string;
  options?: readonly SelectOption[];
  onStage: (field: SettingsField, raw: string) => void;
}) {
  const opts = options ?? selectOptions(field);
  const unknown = shown !== '' && !opts.some((o) => o.value === shown);  // Manually changing the value of.env.local is also displayed faithfully
  const items = [
    ...(unknown ? [{ value: shown, label: shown }] : []),
    ...opts.map((o) => ({ value: o.value, label: selectOptionLabel(status, field, o) })),
  ];
  return (
    <GlassSelect value={shown} options={items} label={field.label}
      onChange={(next) => onStage(field, next)} />
  );
}
