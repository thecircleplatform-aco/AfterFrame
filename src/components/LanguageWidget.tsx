// Language switcher: a compact pill that names the current language, and a
// searchable panel listing every supported language.
//
// Switching re-renders the whole app through `setLocale()` — no reload — because
// every string goes through `t()`/`useT()`. The six authored locales come from
// hand-written dictionaries; the rest are machine-translated on demand by
// `i18n/autoTranslate.ts` (Google Translate when a key is configured, MyMemory
// otherwise). Translations are cached per locale in localStorage, so a language
// is paid for once per browser.
import { useEffect, useMemo, useRef, useState } from 'react';
import { theme, themeAlpha } from '../theme';
import { Icon } from '../modules/icons';
import {
  ALL_LOCALES, LANGUAGE_LABELS, getLocale, hasAuthoredDictionary, setLocale, useT,
  type Locale,
} from '../i18n/locale';
import { autoTranslateHasApiKey } from '../i18n/autoTranslate';

/** Accent-insensitive, case-insensitive match so "espanol" finds "Español". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Honour the OS "reduce motion" setting — the rail just appears/disappears. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * Content cascade behind the rail: each block fades up a few pixels with its
 * own delay, so the panel looks like it is unrolling rather than snapping in.
 */
function reveal(shown: boolean, reduceMotion: boolean, delayMs: number): React.CSSProperties {
  if (reduceMotion) return { opacity: 1 };
  return {
    position: 'relative',
    opacity: shown ? 1 : 0,
    transform: shown ? 'translateY(0)' : 'translateY(-4px)',
    transition: `opacity 200ms ease ${delayMs}ms, transform 260ms cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms`,
  };
}

export function LanguageWidget({ placement = 'down' }: { placement?: 'down' | 'up' }) {
  const t = useT();
  const locale = getLocale();
  const [open, setOpen] = useState(false);
  // Three-phase mount so the rail can play out AND back in:
  //   visible   — panel is in the DOM
  //   shown     — drives the open/closed transform (toggle to animate)
  //   exiting   — pointer-events off while the close animation runs
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    const clearClose = (): void => {
      if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    };
    if (open) {
      clearClose();
      setVisible(true);
      // One frame mounted collapsed, then flip to open so there is a start value.
      const raf = requestAnimationFrame(() => setShown(true));
      // Focus the search box so the user can type a language immediately.
      const focusId = window.setTimeout(() => searchRef.current?.focus(), 30);
      const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false); };
      window.addEventListener('keydown', onKey);
      return () => {
        clearClose();
        cancelAnimationFrame(raf);
        window.clearTimeout(focusId);
        window.removeEventListener('keydown', onKey);
      };
    }
    // Closing: collapse first, unmount when the transition has finished.
    setShown(false);
    setQuery('');
    closeTimer.current = window.setTimeout(() => { setVisible(false); closeTimer.current = null; }, reduceMotion ? 0 : 200);
    return clearClose;
  }, [open, reduceMotion]);

  const results = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return ALL_LOCALES;
    return ALL_LOCALES.filter((code) => {
      const label = LANGUAGE_LABELS[code];
      return fold(label.english).includes(needle)
        || fold(label.native).includes(needle)
        || fold(label.code).includes(needle)
        || code.includes(needle);
    });
  }, [query]);

  const choose = (next: Locale): void => {
    setLocale(next);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }} className="cc-lang">
      <button
        type="button"
        className="cc-tip cc-tip-r"
        data-tip={t('Switch UI language')}
        aria-label={t('Switch UI language')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{
          minWidth: 32, height: 24, background: open ? theme.panelAlt : 'none',
          border: `0.5px solid ${theme.border}`, borderRadius: 6, cursor: 'pointer',
          padding: '0 7px', fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
          color: open ? theme.text : theme.textDim, display: 'inline-flex',
          alignItems: 'center', gap: 5,
        }}
        onMouseEnter={(event) => { event.currentTarget.style.color = theme.text; }}
        onMouseLeave={(event) => { if (!open) event.currentTarget.style.color = theme.textDim; }}
      >
        <span aria-hidden="true" style={{ display: 'inline-flex', opacity: 0.8 }}>
          <Icon name="globe" size={13} />
        </span>
        <span>{LANGUAGE_LABELS[locale].code}</span>
      </button>

      {visible && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 120,
              opacity: shown ? 1 : 0, transition: reduceMotion ? 'none' : 'opacity 180ms ease',
              pointerEvents: shown ? 'auto' : 'none',
            }}
          />
          <div
            role="dialog"
            aria-label={t('Switch UI language')}
            className="cc-lang-panel"
            data-shown={shown ? 'true' : 'false'}
            style={{
              position: 'absolute', zIndex: 121, width: 264,
              ...(placement === 'up' ? { bottom: 'calc(100% + 8px)' } : { top: 'calc(100% + 8px)' }),
              right: 0,
              background: theme.panelAlt, border: `0.5px solid ${theme.borderLight}`,
              borderRadius: 10, boxShadow: `0 18px 44px ${themeAlpha.shadow(0.5)}`,
              padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
              pointerEvents: shown ? 'auto' : 'none',
              // "Rail" motion: the panel slides out of the trigger edge while the
              // contents stretch in behind it. `translateY` from the trigger side
              // gives direction, the scaleY grow reads as a drawer rail.
              transformOrigin: placement === 'up' ? 'bottom right' : 'top right',
              transform: shown || reduceMotion
                ? 'translateY(0) scaleY(1)'
                : `translateY(${placement === 'up' ? 6 : -6}px) scaleY(0.94)`,
              opacity: shown || reduceMotion ? 1 : 0,
              clipPath: reduceMotion ? undefined : 'inset(0 round 10px)',
              transition: reduceMotion
                ? 'none'
                : 'transform 240ms cubic-bezier(0.16, 1, 0.3, 1), opacity 160ms ease',
              willChange: 'transform, opacity',
            }}
          >
            <div style={reveal(shown, reduceMotion, 40)}>
              <span aria-hidden="true" style={{
                position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
                color: theme.textDim, display: 'inline-flex',
              }}>
                <Icon name="search" size={13} />
              </span>
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('Search languages')}
                aria-label={t('Search languages')}
                style={{
                  width: '100%', boxSizing: 'border-box', height: 32, padding: '0 10px 0 28px',
                  borderRadius: 7, border: `1px solid ${themeAlpha.ink(0.12)}`,
                  background: themeAlpha.ink(0.04), color: theme.text, fontSize: 12.5,
                  outline: 'none', font: 'inherit',
                }}
              />
            </div>

            <div role="listbox" style={{
              maxHeight: 268, overflowY: 'auto', display: 'flex',
              flexDirection: 'column', gap: 1,
              ...reveal(shown, reduceMotion, 80),
            }}>
              {results.length === 0 && (
                <span style={{ padding: '10px 8px', fontSize: 12, color: theme.textDim }}>
                  {t('No languages match')}
                </span>
              )}
              {results.map((code) => {
                const label = LANGUAGE_LABELS[code];
                const active = code === locale;
                return (
                  <button
                    key={code}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => choose(code)}
                    style={{
                      font: 'inherit', fontSize: 12.5, display: 'flex', alignItems: 'center',
                      gap: 9, width: '100%', padding: '7px 8px', border: 'none',
                      borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                      color: theme.text, background: active ? themeAlpha.ink(0.08) : 'none',
                    }}
                    onMouseEnter={(event) => { if (!active) event.currentTarget.style.background = themeAlpha.ink(0.05); }}
                    onMouseLeave={(event) => { if (!active) event.currentTarget.style.background = 'none'; }}
                  >
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label.native}
                      </span>
                      <span style={{ fontSize: 10.5, color: theme.textDim }}>{label.english}</span>
                    </span>
                    {!hasAuthoredDictionary(code) && (
                      <span
                        title={t('Translated automatically')}
                        style={{ fontSize: 9.5, color: theme.textDim, opacity: 0.75, letterSpacing: 0.3 }}
                      >
                        {t('auto')}
                      </span>
                    )}
                    {active && (
                      <span style={{ color: theme.accent, display: 'inline-flex' }}>
                        <Icon name="check" size={12} strokeWidth={2.4} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div style={{
              fontSize: 10.5, lineHeight: 1.45, color: theme.textDim, padding: '2px 4px 0',
              ...reveal(shown, reduceMotion, 120),
            }}>
              {autoTranslateHasApiKey()
                ? t('Unlisted strings are translated on demand.')
                : t('Unlisted strings are translated by the free fallback service.')}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
