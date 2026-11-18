/**
 * Free-tier BYOK settings.
 *
 * A self-contained panel: tier switch, per-provider key entry, and the R2 asset
 * installer. Deliberately standalone rather than wired into `settingsSchema`,
 * because the schema drives the whole vendor pane and adding a row there would
 * risk the existing Settings flow. Drop this anywhere a panel fits.
 *
 * Keys are held in localStorage on this device only (see `tier/byok.ts`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { theme } from '../../theme';
import {
  BYOK_BROWSER_SAFE_PROVIDERS,
  RUNTIME_ASSETS,
  byokKeyCount,
  clearByokKeys,
  getByokKey,
  getByokBaseUrl,
  installRuntimeGroup,
  maskKey,
  readChosenTier,
  setByokBaseUrl,
  setByokKey,
  writeChosenTier,
  type InstallProgress,
  type TierId,
} from '../../tier';

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  xai: 'xAI',
  groq: 'Groq',
  ollama: 'Ollama (local)',
  lmstudio: 'LM Studio (local)',
};

const label = (id: string) => PROVIDER_LABELS[id] ?? id;

export function TierByokPanel() {
  const [tier, setTier] = useState<TierId>(() => readChosenTier() ?? 'free');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [savedCount, setSavedCount] = useState(() => byokKeyCount());
  const [installing, setInstalling] = useState<InstallProgress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Seed the visible fields from storage once, so typing is never interrupted.
  useEffect(() => {
    const next: Record<string, string> = {};
    const nextUrls: Record<string, string> = {};
    for (const provider of BYOK_BROWSER_SAFE_PROVIDERS) {
      next[provider] = getByokKey(provider);
      nextUrls[provider] = getByokBaseUrl(provider);
    }
    setDraft(next);
    setUrls(nextUrls);
  }, []);

  const chooseTier = useCallback((next: TierId) => {
    writeChosenTier(next);
    setTier(next);
    setNotice(next === 'free'
      ? 'Free tier: keys are stored in this browser only.'
      : 'Hosted tier: provider keys are applied by the server.');
  }, []);

  const save = useCallback((provider: string) => {
    setByokKey(provider, draft[provider] ?? '');
    setByokBaseUrl(provider, urls[provider] ?? '');
    setSavedCount(byokKeyCount());
    setNotice(`${label(provider)} key ${draft[provider]?.trim() ? 'saved' : 'removed'}.`);
  }, [draft, urls]);

  const install = useCallback(async (groupId: string) => {
    const group = RUNTIME_ASSETS.find((g) => g.id === groupId);
    if (!group) return;
    setInstalling({ groupId, completed: 0, total: group.files.length, currentPath: '' });
    const result = await installRuntimeGroup(group, { onProgress: setInstalling });
    setInstalling(null);
    if (result.ok) {
      setNotice(`${group.label} installed (${result.assets.length} files).`);
      return;
    }
    const error = result.error;
    setNotice(
      error.kind === 'http'
        ? `Could not download ${error.path} (HTTP ${error.status}).`
        : error.kind === 'integrity'
          ? `Checksum mismatch for ${error.path} — download discarded.`
          : 'Install cancelled.',
    );
  }, []);

  const rows = useMemo(() => BYOK_BROWSER_SAFE_PROVIDERS, []);

  const sectionStyle = {
    border: `0.5px solid ${theme.border}`,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    background: theme.panelAlt,
  } as const;

  return (
    <div style={{ fontSize: 12.5, color: theme.text }}>
      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Plan</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {(['free', 'paid'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => chooseTier(id)}
              aria-pressed={tier === id}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                border: `0.5px solid ${tier === id ? theme.accent : theme.border}`,
                background: tier === id ? theme.hover : 'transparent',
                color: theme.text,
                fontWeight: tier === id ? 600 : 400,
              }}
            >
              {id === 'free' ? 'Free — bring your own key' : 'Hosted — server keys'}
            </button>
          ))}
        </div>
        <div style={{ color: theme.textDim, lineHeight: 1.5 }}>
          {tier === 'free'
            ? 'Your key stays on this device. The browser calls the provider directly, so it works offline and nothing is billed through us.'
            : 'Provider keys are applied by our server. Use this if your provider blocks browser requests.'}
        </div>
      </div>

      {tier === 'free' && (
        <div style={sectionStyle}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>API keys</div>
          <div style={{ color: theme.textDim, marginBottom: 10, lineHeight: 1.5 }}>
            Paste a key to enable that provider. {savedCount > 0
              ? `${savedCount} saved on this device.`
              : 'None saved yet.'}
          </div>
          {rows.map((provider) => {
            const saved = getByokKey(provider);
            const local = provider === 'ollama' || provider === 'lmstudio';
            return (
              <div key={provider} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ width: 130, flexShrink: 0 }}>{label(provider)}</span>
                <input
                  type="password"
                  value={draft[provider] ?? ''}
                  placeholder={local ? 'no key needed' : 'sk-…'}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [provider]: event.target.value }))}
                  style={{
                    flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 5,
                    border: `0.5px solid ${theme.border}`, background: theme.inset,
                    color: theme.text, fontFamily: 'inherit', fontSize: 12,
                  }}
                />
                <input
                  value={urls[provider] ?? ''}
                  placeholder="base URL (optional)"
                  onChange={(event) => setUrls((prev) => ({ ...prev, [provider]: event.target.value }))}
                  style={{
                    width: 150, padding: '5px 8px', borderRadius: 5,
                    border: `0.5px solid ${theme.border}`, background: theme.inset,
                    color: theme.text, fontFamily: 'inherit', fontSize: 11,
                  }}
                />
                <button type="button" onClick={() => save(provider)}
                  style={{
                    padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
                    border: `0.5px solid ${theme.border}`, background: theme.hover, color: theme.text, fontSize: 11.5,
                  }}>
                  Save
                </button>
                <span style={{ width: 90, color: theme.textDim, fontSize: 10.5 }}>
                  {saved ? maskKey(saved) : ''}
                </span>
              </div>
            );
          })}
          <button type="button"
            onClick={() => { clearByokKeys(); setDraft({}); setSavedCount(0); setNotice('All keys removed from this device.'); }}
            style={{
              marginTop: 6, padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
              border: `0.5px solid ${theme.border}`, background: 'transparent', color: theme.danger, fontSize: 11.5,
            }}>
            Remove all keys
          </button>
          <div style={{ marginTop: 8, color: theme.textDim, fontSize: 11, lineHeight: 1.5 }}>
            Anthropic and Gemini block browser-origin requests, so they are only available on
            the Hosted tier.
          </div>
        </div>
      )}

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Offline components</div>
        <div style={{ color: theme.textDim, marginBottom: 10, lineHeight: 1.5 }}>
          Downloaded once, then available without a connection.
        </div>
        {RUNTIME_ASSETS.map((group) => {
          const busy = installing?.groupId === group.id;
          return (
            <div key={group.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <span style={{ flex: 1 }}>
                <div>{group.label}</div>
                <div style={{ color: theme.textDim, fontSize: 11 }}>{group.description}</div>
              </span>
              <button type="button" disabled={busy} onClick={() => void install(group.id)}
                style={{
                  padding: '5px 12px', borderRadius: 5, cursor: busy ? 'default' : 'pointer',
                  border: `0.5px solid ${theme.border}`, background: theme.hover,
                  color: theme.text, fontSize: 11.5, opacity: busy ? 0.6 : 1,
                }}>
                {busy ? `${installing.completed}/${installing.total}` : 'Install'}
              </button>
            </div>
          );
        })}
      </div>

      {notice && (
        <div role="status" style={{ color: theme.textDim, fontSize: 11.5, lineHeight: 1.5 }}>
          {notice}
        </div>
      )}
    </div>
  );
}
