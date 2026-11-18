import type { CSSProperties } from 'react';

// Product-identity edged surfaces used to be framed by an animated rainbow
// gradient. That read as decoration on every card and fought the content, so the
// rim is now a plain hairline in the surrounding border colour. The component is
// kept (rather than deleted) because it is the one place the frame radius and
// z-index live — callers do not need to change.
const RIM_COLOR = 'var(--cc-border)';

export interface BrandRimProps {
  /** `live` speeds the drift up and brightens the rim (agent working, export running…). */
  tone?: 'soft' | 'live';
  /** Corner radius of the surface the rim hugs. */
  radius?: number;
  /** `inset` hugs the nearest positioned ancestor; `window` frames the whole viewport. */
  variant?: 'inset' | 'window';
}

/**
 * Animated brand-gradient hairline drawn on the edge of the nearest positioned
 * ancestor (or of the window with `variant="window"`). Masked to the 2px rim so
 * the surface underneath is untouched, and pointer-events free so it never
 * blocks clicks.
 */
export function BrandRim({ tone = 'soft', radius = 0, variant = 'inset' }: BrandRimProps) {
  const style: CSSProperties = {
    position: variant === 'window' ? 'fixed' : 'absolute',
    inset: 0,
    zIndex: 30,
    pointerEvents: 'none',
    padding: 1,
    borderRadius: radius,
    backgroundImage: RIM_COLOR,
    opacity: 1,
  };
  return (
    <span
      aria-hidden="true"
      className={tone === 'live' ? 'cc-brand-rim cc-brand-rim--live' : 'cc-brand-rim'}
      style={style}
    />
  );
}
