import { useT } from '../../i18n/locale';
import { theme, themeAlpha } from '../../theme';
import { selectAgentModel } from '../../agent/model-selection';
import { Icon } from '../../modules/icons';
import { ComposerPopover } from './ComposerPopover';
import { ReasoningEffortPicker, effortChoices } from './ReasoningEffortPicker';
import type { ComposerModelView } from './useComposerModelView';
import { TokenUsage } from '@kitelus/fly-ui';
import codexPng from '../../../assets/vendor-icons/codex-color.png';
import copilotSvg from '../../../assets/vendor-icons/copilot.svg?raw';
import claudeSvg from '../../../assets/vendor-icons/claude-color.svg';

function ChoiceLogo({ backend }: { backend: 'api' | 'codex' | 'copilot' | 'claude-code' }) {
  if (backend === 'copilot') {
    return (
      <span
        aria-hidden
        // Static codebase asset, non-user input — inlined so it inherits currentColor.
        dangerouslySetInnerHTML={{ __html: copilotSvg }}
        style={{ width: 18, height: 18, borderRadius: 5, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.panel, border: `0.5px solid ${theme.borderLight}`, color: theme.text, fontSize: 12 }}
      />
    );
  }
  if (backend !== 'codex' && backend !== 'claude-code') return null;
  return (
    <img
      src={backend === 'codex' ? codexPng : claudeSvg}
      alt=""
      aria-hidden
      style={{ width: 18, height: 18, borderRadius: 5, objectFit: 'contain', flex: '0 0 auto', background: theme.panel, border: `0.5px solid ${theme.borderLight}` }}
    />
  );
}

export function ComposerModelPicker({ anchor, onClose, view }: {
  readonly anchor: HTMLElement | null;
  readonly onClose: () => void;
  readonly view: ComposerModelView;
}) {
  const t = useT();
  const { tokens } = view;
  // The card only earns its space once a run has produced usage; before that
  // the plain "used / limit" readout is enough.
  const showUsage = tokens.input > 0 || tokens.cachedRead > 0;
  return (
    <ComposerPopover width={320} minMaxHeight={520} anchor={anchor} onClose={onClose}>
      {(close) => (<>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 10.5, color: theme.textDim, padding: '4px 8px 6px' }}>
        <span>{t('Model used for this chat')}</span>
        <span title={view.contextTitle} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{view.contextLabel}</span>
      </div>
      {showUsage && view.activeModel && (
        <div className="cc-token-usage" style={{ padding: '0 4px 8px' }}>
          <TokenUsage
            variant="card"
            modelName={view.activeModel.model}
            title={t('Context usage')}
            inputTokens={tokens.input}
            cachedReadTokens={tokens.cachedRead || undefined}
            cachedInputTokens={tokens.cachedWrite || undefined}
            outputTokens={0}
            showCost={false}
            maxTokens={tokens.limit || undefined}
            statLabels={{
              input: t('Input'),
              cached: t('Cached'),
              total: t('Total'),
              max: t('Max'),
            }}
            // Reuse the app's design tokens so the card reads as part of the
            // composer rather than a foreign widget. Surfaces are TRANSPARENT:
            // the kit paints every tile with `--kite-surface`, and any opaque
            // value showed up as white boxes on the dark popover.
            theme={{
              primary: theme.accent,
              primaryForeground: theme.onAccent,
              primarySubtle: themeAlpha.accent(0.14),
              primaryBorder: themeAlpha.accent(0.3),
              foreground: theme.text,
              muted: theme.textDim,
              subtle: themeAlpha.ink(0.45),
              background: 'transparent',
              surface: 'transparent',
              surfaceMuted: themeAlpha.ink(0.05),
              surfaceElevated: 'transparent',
              surfaceOverlay: themeAlpha.ink(0.08),
              border: themeAlpha.ink(0.1),
              borderSubtle: themeAlpha.ink(0.07),
              borderStrong: themeAlpha.ink(0.16),
              divider: themeAlpha.ink(0.06),
              danger: theme.danger,
              success: theme.success,
              radius: '8px',
              radiusSm: '6px',
              radiusXs: '4px',
              radiusLg: '10px',
            }}
          />
        </div>
      )}

      <div style={{ padding: '0 4px 8px' }}>
        <ReasoningEffortPicker
          choices={effortChoices(view.activeModel?.capabilities.reasoningEfforts.value ?? [])}
          value={view.reasoningEffort}
          onChange={view.setReasoningEffort}
          disabled={!view.activeModel?.capabilities.supportsReasoning.value}
        />
      </div>

      {view.modelState.choices.length === 0 && (
        <div style={{ padding: '7px 9px 9px', color: theme.textDim, fontSize: 11.5, lineHeight: 1.5 }}>
          {view.modelState.loaded ? t('Configure at least one model provider in Settings first.') : t('Loading model configuration…')}
        </div>
      )}
      {view.modelState.choices.map((choice) => {
        const active = choice.id === view.modelState.activeId;
        return (
          <button type="button" key={choice.id}
            onClick={() => { selectAgentModel(choice.id); close(); }}
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 9px', border: 0, borderRadius: 3, background: active ? theme.panel : 'transparent', color: theme.text, cursor: 'pointer', textAlign: 'left' }}>
            <ChoiceLogo backend={choice.backend} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: 11.5, fontWeight: 600 }}>{choice.providerLabel}</strong>
              <small style={{ display: 'block', color: theme.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{choice.model}</small>
            </span>
            {active && <span style={{ color: theme.accent, lineHeight: 0 }}><Icon name="check" size={13} /></span>}
          </button>
        );
      })}
      </>)}
    </ComposerPopover>
  );
}
