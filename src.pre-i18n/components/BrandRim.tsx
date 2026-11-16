import type { CSSProperties } from 'react';

// Same product-identity gradient as the agent chat rim (index.css `.cc-chat-panel::after`).
// It lives here rather than in a theme token because the brand gradient is deliberately
// skin-independent: no skin may recolour it.
const RIM_GRADIENT = 'linear-gradient(120deg,#a855f7,#ec4899,#3b82f6,#22d3ee,#a855f7)';

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
    padding: 1.25,
    borderRadius: radius,
    backgroundImage: RIM_GRADIENT,
    backgroundSize: '400% 400%',
    WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    maskComposite: 'exclude',
    opacity: tone === 'live' ? 0.9 : 0.6,
  };
  return (
    <span
      aria-hidden="true"
      className={tone === 'live' ? 'cc-brand-rim cc-brand-rim--live' : 'cc-brand-rim'}
      style={style}
    />
  );
}
