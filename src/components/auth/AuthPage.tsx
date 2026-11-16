import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { theme, themeAlpha } from '../../theme';
import { useT } from '../../i18n/locale';
import { Icon } from '../../modules/icons';
import { AfterFrameLogo } from '../brand/afterframe-logo';
import { AcoCredit } from '../brand/aco-mark';
import { LanguageWidget } from '../LanguageWidget';
import { StarField } from './StarField';
import { googleSignInAvailable, requestPasswordReset, signIn, signUp, startGoogleAuth } from '../../auth/session';
import { navigateTo } from '../../app/appShell';

export type AuthPageMode = 'signin' | 'signup';

/** `down` = the card lifted up out of the way; `left` = sign-up slid in from the right. */
type TransitionKind = 'none' | 'left' | 'up';

/** Google's own four-colour G. Brand guideline: never recolour it. */
function GoogleGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12c-.2 2-1.5 5-4.4 7l6.8 5.3c4-3.7 6.7-9.1 6.7-15.9z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 28.3c-.5-1.4-.8-2.8-.8-4.3s.3-3 .8-4.3l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.8l7.1-5.5z" />
      <path fill="#EA4335" d="M24 10.4c3.3 0 6.2 1.1 8.5 3.3l6.1-6.1C35 4.2 30 2 24 2 15.4 2 8 6.9 4.4 14.2l7.1 5.5c1.8-5.3 6.7-9.3 12.5-9.3z" />
    </svg>
  );
}

/**
 * The front door. Not a dialog: until you have an account there is nothing else
 * to see, so the page owns the whole viewport — brand and promise on the left,
 * the form on the right, and the form collapses to a single column under 900px.
 */
export function AuthPage({ mode }: { mode: AuthPageMode }) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const signup = mode === 'signup';
  const modeRef = useRef<AuthPageMode>(mode);
  // Which motion the card is currently expressing. `mode` alone cannot tell us
  // that a *switch* happened, and the outgoing card has to leave in the same
  // direction the incoming one arrives from, so we remember the last change.
  const [transitionKind, setTransitionKind] = useState<TransitionKind>('none');
  // The forgot-password sheet is its own layer: it rises over the card rather
  // than swapping the form, so the user's typed email is still there underneath.
  const [forgotOpen, setForgotOpen] = useState(false);
  useEffect(() => {
    if (modeRef.current === mode) return;
    modeRef.current = mode;
    setTransitionKind(mode === 'signup' ? 'left' : 'up');
  }, [mode]);
  // `html, body, #root` are overflow:hidden for the editor shell, so this page owns
  // its own scroll container. A scrollable box that never holds focus ignores
  // arrow keys / PageDown / Home / End — focusing it on mount restores keyboard
  // scrolling without stealing the caret from any field (the user has not
  // tabbed into one yet).
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pageRef.current?.focus({ preventScroll: true });
  }, []);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState<'idle' | 'sent'>('idle');
  const [resetLink, setResetLink] = useState<string | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = signup
      ? await signUp(email.trim(), password, name.trim() || undefined)
      : await signIn(email.trim(), password);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    navigateTo('#/');
  };

  const sendReset = async (): Promise<void> => {
    if (!email.trim()) { setError(t('Enter your email first, then ask for a reset link.')); return; }
    setBusy(true);
    setError(null);
    const result = await requestPasswordReset(email.trim());
    setBusy(false);
    setForgot('sent');
    // Only local dev returns a link (no mail worker); production never does.
    setResetLink(result.link ?? null);
  };

  const field: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', height: 44, padding: '0 14px',
    borderRadius: 11, border: `1px solid ${themeAlpha.ink(0.12)}`,
    background: themeAlpha.ink(0.04), color: theme.text, fontSize: 14,
    outline: 'none', font: 'inherit',
  };
  const label: React.CSSProperties = {
    display: 'block', marginBottom: 6, fontSize: 12, fontWeight: 550, color: theme.textDim,
  };

  return (
    <div ref={pageRef} tabIndex={-1} style={{
      minHeight: '100vh', display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      // Deep space: near-black with a faint blue lift at the top so the glass
      // panels have something to sit against.
      background: 'radial-gradient(120% 90% at 50% 0%, #101423 0%, #080a12 45%, #050609 100%)',
      color: theme.text, position: 'relative', isolation: 'isolate',
    }} className="cc-auth-page">
      <StarField />
      {/* Promise panel — hidden by CSS under 900px so the form gets the screen. */}
      <div className="cc-auth-hero" style={{
        flexDirection: 'column', justifyContent: 'space-between',
        padding: '48px 56px', position: 'relative', zIndex: 1,
      }}>
        <AfterFrameLogo size="md" glow />
        <div style={{ maxWidth: 420 }}>
          <h1 style={{
            margin: 0, fontSize: 40, lineHeight: 1.1, letterSpacing: '-0.03em',
            fontWeight: 640, color: theme.textStrong,
          }}>
            {t('Edit video by talking to it.')}
          </h1>
          <p style={{
            margin: '18px 0 0', fontSize: 14.5, lineHeight: 1.65, color: theme.textDim,
          }}>
            {t('AfterFrame is a timeline, an agent and a browser-side renderer in one window. Nothing uploads, nothing renders on our machines — your footage stays on your device.')}
          </p>
          <ul style={{ margin: '26px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {[
              t('Multi-track editing with captions, motion graphics and LUTs'),
              t('An agent that cuts, grades and captions on request'),
              t('Export at full quality, encoded in your browser'),
            ].map((line) => (
              <li key={line} style={{ display: 'flex', gap: 10, fontSize: 13, color: theme.text, lineHeight: 1.5 }}>
                <span aria-hidden="true" style={{ color: theme.textStrong, flexShrink: 0, marginTop: 1 }}>
                  <Icon name="check" size={15} />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: theme.textDim }}>
            {t('Free while in beta · your account keeps projects together across devices')}
          </span>
          <AcoCredit />
        </div>
      </div>

      {/* Form panel */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px', gap: 18, position: 'relative', zIndex: 1,
        // The card rotates on Y during a mode switch; perspective on the parent
        // is what gives that rotation depth instead of a flat squash.
        perspective: 1200,
      }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 380 }}>
        <AnimatePresence mode="wait" initial={false} custom={transitionKind}>
          {forgotOpen ? (
            /* Reset is a PEER of the sign-in card, not an overlay on top of it:
               it rises from below while the sign-in card sinks away, so the two
               never occupy the same glass panel. */
            <motion.div
              key="forgot"
              initial={reduceMotion ? false : { opacity: 0, y: 72, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: 72, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 280, damping: 30, mass: 0.85 }}
              role="dialog"
              aria-modal="true"
              aria-label={t('Reset your password')}
              style={glassCard}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em', color: theme.textStrong }}>
                  {t('Reset your password')}
                </h2>
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: theme.textDim, lineHeight: 1.5 }}>
                  {t('We will email you a link to choose a new one.')}
                </p>
              </div>
              <div>
                <label style={label} htmlFor="af-reset-email">{t('Email')}</label>
                <input
                  id="af-reset-email" style={field} value={email} type="email" required autoComplete="email"
                  placeholder="you@studio.com"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              {forgot === 'sent' && (
                <span role="status" style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.textDim }}>
                  {t('If that address has an account, a reset link is on its way.')}
                </span>
              )}
              {resetLink && (
                <a href={resetLink} style={{ fontSize: 11.5, color: theme.text, wordBreak: 'break-all', lineHeight: 1.5 }}>
                  {t('No mail server in dev — open the reset link')}
                </a>
              )}
              <button
                type="button" disabled={busy}
                onClick={() => void sendReset()}
                style={{
                  height: 44, borderRadius: 999, border: 'none',
                  cursor: busy ? 'default' : 'pointer',
                  background: theme.accent, color: theme.onAccent,
                  fontSize: 14, fontWeight: 620, opacity: busy ? 0.65 : 1,
                  boxShadow: `0 10px 24px -12px ${themeAlpha.accent(0.6)}`,
                }}
              >
                {busy ? t('Working…') : t('Send reset link')}
              </button>
              <button
                type="button"
                onClick={() => { setForgotOpen(false); setForgot('idle'); setResetLink(null); }}
                style={{ ...linkStyle, textAlign: 'center' }}
              >
                {t('Back to sign in')}
              </button>
            </motion.div>
          ) : (
          <motion.form
            key={mode}
            onSubmit={submit}
            initial={reduceMotion ? false : cardVariants.enter(transitionKind)}
            animate={cardVariants.center}
            exit={reduceMotion ? undefined : cardVariants.exit(transitionKind)}
            transition={{
              type: 'spring', stiffness: 290, damping: 32, mass: 0.85,
              opacity: { duration: 0.22, ease: 'easeOut' },
            }}
            style={glassCard}
          >
          {/* Language switcher lives in the card's top-right corner. */}
          <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 2 }}>
            <LanguageWidget />
          </div>
          <div style={{ paddingRight: 44 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em', color: theme.textStrong }}>
              {signup ? t('Create your account') : t('Sign in')}
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: theme.textDim, lineHeight: 1.5 }}>
              {signup
                ? t('One account, every device. Takes about ten seconds.')
                : t('Welcome back — pick up where you left off.')}
            </p>
          </div>

          {signup && (
            <div>
              <label style={label} htmlFor="af-name">{t('Display name')}</label>
              <input
                id="af-name" style={field} value={name} autoComplete="name"
                placeholder={t('Optional')}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}

          <div>
            <label style={label} htmlFor="af-email">{t('Email')}</label>
            <input
              id="af-email" style={field} value={email} type="email" required autoComplete="email"
              placeholder="you@studio.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div>
            <label style={label} htmlFor="af-password">{t('Password')}</label>
            <div style={{ position: 'relative' }}>
              <input
                id="af-password" style={{ ...field, paddingRight: 44 }}
                value={password} required minLength={8}
                type={showPassword ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
                placeholder={signup ? t('At least 8 characters') : '••••••••'}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? t('Hide password') : t('Show password')}
                style={{
                  position: 'absolute', right: 6, top: 6, width: 32, height: 32,
                  border: 'none', background: 'none', cursor: 'pointer',
                  color: theme.textDim, borderRadius: 8, display: 'grid', placeItems: 'center',
                }}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
              </button>
            </div>
          </div>

          {error && (
            <span role="alert" style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.danger }}>{error}</span>
          )}

          <button
            type="submit" disabled={busy}
            style={{
              height: 44, borderRadius: 999, border: 'none',
              cursor: busy ? 'default' : 'pointer',
              background: theme.accent, color: theme.onAccent,
              fontSize: 14, fontWeight: 620, opacity: busy ? 0.65 : 1,
              boxShadow: `0 10px 24px -12px ${themeAlpha.accent(0.6)}`,
              transition: 'opacity .15s ease, transform .15s ease',
            }}
          >
            {busy ? t('Working…') : signup ? t('Create account') : t('Sign in')}
          </button>

          {googleSignInAvailable() && (
            <>
              <span style={{
                display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 11, color: theme.textDim, letterSpacing: '0.04em',
              }}>
                <span style={{ flex: 1, height: 1, background: themeAlpha.ink(0.09) }} />
                {t('or')}
                <span style={{ flex: 1, height: 1, background: themeAlpha.ink(0.09) }} />
              </span>
              <button
                type="button"
                onClick={() => { void startGoogleAuth(); }}
                style={{
                  height: 44, borderRadius: 999, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                  border: `1px solid ${themeAlpha.ink(0.14)}`, background: 'transparent',
                  color: theme.text, fontSize: 13.5, fontWeight: 550,
                }}
              >
                <GoogleGlyph />
                {t('Continue with Google')}
              </button>
            </>
          )}

          <div style={{
            display: 'flex', justifyContent: 'space-between', gap: 12,
            fontSize: 12, color: theme.textDim,
          }}>
            {signup ? (
              <button type="button" onClick={() => navigateTo('#/signin')} style={linkStyle}>
                {t('I already have an account')}
              </button>
            ) : (
              <>
                <button type="button" onClick={() => setForgotOpen(true)} style={linkStyle}>
                  {t('Forgot password?')}
                </button>
                <button type="button" onClick={() => navigateTo('#/signup')} style={linkStyle}>
                  {t('Create an account')}
                </button>
              </>
            )}
          </div>
          </motion.form>
          )}
        </AnimatePresence>
        </div>
        <AcoCredit />
      </div>
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'inherit', font: 'inherit', textDecoration: 'underline',
  textUnderlineOffset: 3,
};

/**
 * Card choreography for mode switches.
 *
 * `left` — sign-up: the old card slides out to the LEFT and the new one arrives
 *          from the RIGHT, like turning a page. A little rotation plus a
 *          perspective tilt makes it read as a physical card rather than a
 *          rectangle sliding on a conveyor belt.
 * `up`   — back to sign-in: the card lifts upward and away while the new one
 *          rises into place from below.
 *
 * Both keep opacity high early so the text stays legible mid-flight, and both
 * end on the exact same resting transform (`center`) so there is no snap.
 */
const cardVariants = {
  center: { opacity: 1, x: 0, y: 0, rotate: 0, rotateY: 0, scale: 1 },
  enter: (kind: TransitionKind) => {
    if (kind === 'left') return { opacity: 0, x: 90, y: 0, rotate: -3, rotateY: 14, scale: 0.96 };
    if (kind === 'up') return { opacity: 0, x: 0, y: 56, rotate: 1.5, rotateY: 0, scale: 0.97 };
    return { opacity: 0, y: 14, scale: 0.985 };
  },
  exit: (kind: TransitionKind) => {
    if (kind === 'left') return { opacity: 0, x: -90, y: 0, rotate: 3, rotateY: -14, scale: 0.96 };
    if (kind === 'up') return { opacity: 0, x: 0, y: -46, rotate: -1.5, rotateY: 0, scale: 0.97 };
    return { opacity: 0, y: -10, scale: 0.985 };
  },
};

/**
 * Frosted glass card. The blur reads against the star field behind it, so the
 * panel is translucent rather than opaque; the inner highlight (a 1px inset
 * white line at the top) is what sells it as a pane of glass instead of a flat
 * translucent rectangle.
 */
const glassCard: React.CSSProperties = {
  width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14,
  padding: 26, borderRadius: 20, position: 'relative',
  background: 'linear-gradient(160deg, rgba(255,255,255,0.085) 0%, rgba(255,255,255,0.035) 45%, rgba(255,255,255,0.02) 100%)',
  backdropFilter: 'blur(22px) saturate(140%)',
  WebkitBackdropFilter: 'blur(22px) saturate(140%)',
  border: '1px solid rgba(255,255,255,0.11)',
  boxShadow: '0 28px 70px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(255,255,255,0.04)',
};
