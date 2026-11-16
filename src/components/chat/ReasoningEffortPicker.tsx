// Reasoning-effort selector: a single row of four segments.
//
// The values come from the model's own capability entry (`reasoningEfforts`),
// which for deepseek-v4-flash is low | high | max. "None" is always offered and
// means "let the model run without extended reasoning", so a model that supports
// reasoning can still be asked to skip it.
//
// The choices are written into the same keystore key the settings pane uses
// (CODEX_REASONING_EFFORT / COPILOT_REASONING_EFFORT) for those backends; for
// plain API models the effort is part of the request body, so we hand it to the
// model-selection layer instead.
import { useT } from '../../i18n/locale';
import { theme, themeAlpha } from '../../theme';

/** `none` plus whatever the model advertises, in the catalog's own order. */
export function effortChoices(reasoningEfforts: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = ['none'];
  for (const effort of reasoningEfforts) {
    const value = effort.trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function ReasoningEffortPicker({
  choices,
  value,
  onChange,
  disabled,
}: {
  readonly choices: readonly string[];
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly disabled?: boolean;
}) {
  const t = useT();
  const label = (effort: string): string => {
    if (effort === 'none') return t('None');
    if (effort === 'low') return t('Low');
    if (effort === 'medium') return t('Medium');
    if (effort === 'high') return t('High');
    if (effort === 'max') return t('Max');
    return effort;
  };
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 10.5, color: theme.textDim, padding: '0 2px 5px',
      }}>
        <span>{t('Thinking effort')}</span>
        {disabled && <span style={{ opacity: 0.7 }}>{t('Not supported')}</span>}
      </div>
      <div
        role="radiogroup"
        aria-label={t('Thinking effort')}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))`,
          gap: 2, padding: 2, borderRadius: 7,
          background: themeAlpha.ink(0.05),
          border: `0.5px solid ${themeAlpha.ink(0.08)}`,
        }}
      >
        {choices.map((effort) => {
          const active = effort === value;
          return (
            <button
              key={effort}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(effort)}
              style={{
                font: 'inherit', fontSize: 11, fontWeight: active ? 600 : 500,
                height: 24, padding: '0 4px', border: 'none', borderRadius: 5,
                cursor: disabled ? 'default' : 'pointer',
                color: active ? theme.textStrong : theme.textDim,
                background: active ? themeAlpha.ink(0.12) : 'transparent',
                boxShadow: active ? `0 1px 2px ${themeAlpha.shadow(0.35)}` : 'none',
                opacity: disabled ? 0.5 : 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                transition: 'background 120ms ease, color 120ms ease',
              }}
              onMouseEnter={(event) => {
                if (!active && !disabled) event.currentTarget.style.background = themeAlpha.ink(0.06);
              }}
              onMouseLeave={(event) => {
                if (!active) event.currentTarget.style.background = 'transparent';
              }}
            >
              {label(effort)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
