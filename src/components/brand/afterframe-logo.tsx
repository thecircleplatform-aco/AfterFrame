import { useRef, useState, type PointerEvent } from 'react';
import { theme } from '../../theme';
import { AfterFrameMark } from './afterframe-mark';

/**
 * The AfterFrame lockup, ported from FreeCut
 * (`freecut/src/components/brand/afterframe-logo.tsx`).
 *
 * The mark is the shipped PNG used as a mask (so it takes `currentColor`); the
 * wordmark is real text, not a second SVG — that is what keeps it crisp at any
 * zoom and lets it inherit the theme's type colour.
 *
 * `glow` is FreeCut's pointer-following reveal: the brand spectrum is painted
 * into the letterforms and cut back by a radial mask centred on the cursor, so
 * only the area near the pointer picks up colour instead of the whole lockup
 * getting a flat tint. The overlay multiplies, so the spectrum only shows
 * *inside* the white glyphs — the surrounding surface stays untouched.
 */

const SIZE = {
  sm: { mark: 16, text: 15, gap: 6 },
  md: { mark: 22, text: 20, gap: 8 },
  lg: { mark: 30, text: 30, gap: 10 },
} as const;

/**
 * The hole the spectrum is seen through: strong at the pointer, feathered out
 * to nothing, so it reads as mist rather than a hard spotlight disc.
 */
const SPOTLIGHT =
  'radial-gradient(circle 92px at var(--af-glow-x, 50%) var(--af-glow-y, 50%), rgb(0 0 0 / 0.95), rgb(0 0 0 / 0.6) 34%, rgb(0 0 0 / 0.22) 60%, transparent 80%)';

/** Paints the brand spectrum into text glyphs. */
const GRADIENT_TEXT = {
  backgroundImage: 'var(--brand-gradient)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
} as const;

/** The wordmark on its own — real text, so it stays crisp and inherits colour. */
export function AfterFrameWordmark({
  size = 'md',
  gradient = false,
}: {
  size?: keyof typeof SIZE;
  /** Paints the brand spectrum into the glyphs (hover glow overlay). */
  gradient?: boolean;
}) {
  return (
    <span
      style={{
        fontSize: SIZE[size].text,
        fontWeight: 600,
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
        lineHeight: 1,
        ...(gradient ? GRADIENT_TEXT : null),
      }}
    >
      AfterFrame
    </span>
  );
}

export function AfterFrameLogo({
  variant = 'full',
  size = 'md',
  glow = false,
}: {
  variant?: 'full' | 'icon';
  size?: keyof typeof SIZE;
  /** Pointer-following brand spectrum. Hover-only; costs nothing until hovered. */
  glow?: boolean;
}) {
  const config = SIZE[size];
  const rootRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);

  const trackPointer = (event: PointerEvent<HTMLSpanElement>): void => {
    if (!glow) return;
    const element = rootRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty('--af-glow-x', `${event.clientX - rect.left}px`);
    element.style.setProperty('--af-glow-y', `${event.clientY - rect.top}px`);
  };

  const clearPointer = (): void => {
    const element = rootRef.current;
    if (!element) return;
    element.style.removeProperty('--af-glow-x');
    element.style.removeProperty('--af-glow-y');
  };

  if (variant === 'icon') return <AfterFrameMark size={config.mark} />;

  return (
    <span
      ref={rootRef}
      onPointerEnter={glow ? () => setHovered(true) : undefined}
      onPointerMove={glow ? trackPointer : undefined}
      onPointerLeave={
        glow
          ? () => {
            setHovered(false);
            clearPointer();
          }
          : undefined
      }
      style={{
        position: 'relative',
        isolation: 'isolate',
        display: 'inline-flex',
        alignItems: 'center',
        gap: config.gap,
        color: theme.text,
      }}
    >
      <AfterFrameMark size={config.mark} />
      <AfterFrameWordmark size={size} />

      {glow && (
        <span
          aria-hidden="true"
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            gap: config.gap,
            opacity: hovered ? 0.95 : 0,
            mixBlendMode: 'multiply',
            transition: 'opacity .3s ease',
            WebkitMaskImage: SPOTLIGHT,
            maskImage: SPOTLIGHT,
          }}
        >
          <AfterFrameMark size={config.mark} backgroundImage="var(--brand-gradient)" />
          <AfterFrameWordmark size={size} gradient />
        </span>
      )}
    </span>
  );
}
