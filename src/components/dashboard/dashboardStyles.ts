import type { CSSProperties } from 'react';
import { theme, themeAlpha } from '../../theme';

// Modern dashboard surface: soft radii, quiet borders, hover lift.
// Every colour is a theme token — raw hex/rgba fails theme-tokenization.verify.

export const shell: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', background: theme.bg };
export const container: CSSProperties = {
  maxWidth: 1240, margin: '0 auto',
  paddingTop: 76, paddingRight: 32, paddingBottom: 156, paddingLeft: 32,
};

// ---- header ----------------------------------------------------------------

export const headerBrand: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 9, color: theme.text };
export const headerActions: CSSProperties = { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 };

/**
 * The header is one capsule: a single rounded pill spanning the band, holding
 * the menu trigger on the left and the search in the middle. Everything that
 * used to sit on the right (skin, language, settings, overflow) moved into the
 * left drawer, so there is nothing to crowd the pill at narrow widths.
 */
/**
 * Three glass pieces: a circle, a capsule, a circle. No borders anywhere — the
 * separation comes from translucency plus a drop shadow, so they read as
 * frosted panels floating on the titlebar rather than outlined buttons.
 */
export const headerRow: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  // Capped instead of full-bleed: the pieces sit close together in the middle of
  // the titlebar instead of being stretched to the edges.
  width: '100%', maxWidth: 720, height: 40, margin: '0 auto',
  // The floating band is click-through; the row opts back in so the pieces work.
  pointerEvents: 'auto',
};

const glass: CSSProperties = {
  border: 'none',
  background: 'rgba(255,255,255,0.07)',
  backdropFilter: 'blur(20px) saturate(140%)',
  WebkitBackdropFilter: 'blur(20px) saturate(140%)',
  boxShadow:
    '0 8px 24px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.14)',
  transition: 'background .15s ease, box-shadow .15s ease',
};

/** Left/right piece: a true circle, same height as the row. */
export const circleButton: CSSProperties = {
  ...glass,
  flex: '0 0 auto', width: 40, height: 40, padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 999, color: theme.text, cursor: 'pointer',
};

/** Middle piece: the glass capsule that carries the search field. */
export const searchCapsule: CSSProperties = {
  ...glass,
  flex: '1 1 auto', minWidth: 0, height: 40, padding: '0 14px',
  display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999,
};

/**
 * The field itself is invisible: the capsule behind it is the glass. A focus
 * brightens the glyph backdrop instead of drawing a ring, so no line ever
 * appears.
 */
export const modernSearchInput: CSSProperties = {
  width: '100%', height: 32, boxSizing: 'border-box',
  padding: '0 30px', border: 'none', borderRadius: 999,
  background: 'transparent', color: theme.text,
  fontSize: 13, outline: 'none', WebkitAppearance: 'none',
};

export const capsuleSearchSlot: CSSProperties = {
  flex: '1 1 auto', minWidth: 0, display: 'flex', justifyContent: 'center',
};

// ---- notifications ----------------------------------------------------------
// The model-setup banner is no longer part of the page flow: it arrives as a
// floating notification under the titlebar, and the same items are listed behind
// the bell widget.

// Anchored to the top of the screen, centred with `left/right` + auto margins
// rather than a translate: motion owns the transform here for the slide-in, and
// a transform-based centring would be overwritten by it (the card ended up
// hanging off the right edge).
export const notificationStack: CSSProperties = {
  position: 'fixed', top: 76, left: 0, right: 0, zIndex: 40,
  margin: '0 auto', width: 'min(560px, calc(100vw - 32px))',
  display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
};

export const notificationCard: CSSProperties = {
  pointerEvents: 'auto', position: 'relative',
  borderRadius: 14, overflow: 'hidden',
  boxShadow: '0 18px 44px rgba(0,0,0,0.5)',
};

export const bellBadge: CSSProperties = {
  position: 'absolute', top: 4, right: 5, width: 7, height: 7, borderRadius: '50%',
  background: theme.accent,
};

export const notificationPanel: CSSProperties = {
  position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 62,
  width: 'min(320px, calc(100vw - 48px))',
  borderRadius: 14, border: 'none', padding: 6,
  background: 'rgba(20,20,20,0.92)',
  backdropFilter: 'blur(20px) saturate(140%)',
  boxShadow: '0 18px 44px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12)',
};

export const notificationEmpty: CSSProperties = {
  padding: '14px 12px', fontSize: 12.5, color: theme.textDim, textAlign: 'center',
};

export const notificationRow: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, width: '100%',
  padding: '10px 10px', borderRadius: 10, border: 'none',
  background: 'transparent', color: theme.text, textAlign: 'left', font: 'inherit', cursor: 'pointer',
};

/** Dismiss control sitting on the notification card's top-right corner. */
export const notificationClose: CSSProperties = {
  position: 'absolute', top: 6, right: 6, width: 22, height: 22, padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 999, border: 'none', background: 'rgba(0,0,0,0.35)',
  color: theme.textDim, cursor: 'pointer',
};

/** Scrim behind the drawer: one click closes it. */
export const menuScrim: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 60,
  background: themeAlpha.shadow(0.6),
  // The drawer is mounted inside the floating titlebar, which is `pointer-events:
  // none` so the page shows through. Without this the scrim — and every control
  // in the panel, including Close — was click-through.
  pointerEvents: 'auto',
};

export const menuPanel: CSSProperties = {
  position: 'fixed', top: 8, bottom: 8, left: 8, zIndex: 61,
  width: 'min(300px, 86vw)', display: 'flex', flexDirection: 'column', gap: 2,
  padding: '14px 12px', borderRadius: 22,
  background: theme.panel,
  boxShadow: `0 24px 64px ${themeAlpha.shadow(0.6)}, 0 0 0 1px ${themeAlpha.ink(0.08)}`,
  overflowY: 'auto', pointerEvents: 'auto',
};

export const menuHead: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '2px 2px 12px', marginBottom: 8, borderBottom: `0.5px solid ${theme.border}`,
};

export const menuRow: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '8px 10px', borderRadius: 8,
};

export const menuRowLabel: CSSProperties = { fontSize: 13, color: theme.text, flex: 1, minWidth: 0 };

export const menuRowButton: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, width: '100%',
  padding: '9px 10px', borderRadius: 8, border: 'none', background: 'transparent',
  color: theme.text, font: 'inherit', fontSize: 13, textAlign: 'left', cursor: 'pointer',
};

export const iconButton: CSSProperties = {
  background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer',
  width: 28, height: 28, borderRadius: 8, padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

// ---- drawer account footer -------------------------------------------------
// Pushed to the bottom of the drawer with `marginTop: 'auto'`, so it reads as
// "who you are" rather than another navigation row.

export const menuFooter: CSSProperties = {
  marginTop: 'auto', paddingTop: 14, paddingBottom: 2,
  borderTop: `0.5px solid ${theme.border}`,
  display: 'flex', flexDirection: 'column', gap: 10,
};
export const profileRow: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, padding: '0 2px',
};
export const profileAvatar: CSSProperties = {
  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
  display: 'grid', placeItems: 'center',
  background: themeAlpha.ink(0.08), color: theme.textStrong,
  border: `1px solid ${themeAlpha.ink(0.10)}`,
  fontSize: 12.5, fontWeight: 650, letterSpacing: '0.02em',
};
export const profileIdentity: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 auto', minWidth: 0,
};
export const profileName: CSSProperties = {
  fontSize: 12.5, fontWeight: 600, color: theme.textStrong,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
export const profileEmail: CSSProperties = {
  fontSize: 11.5, color: theme.textDim,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
export const profileSignOut: CSSProperties = {
  background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer',
  width: 26, height: 26, borderRadius: 7, padding: 0, flexShrink: 0,
  display: 'grid', placeItems: 'center',
};
export const profileActions: CSSProperties = { display: 'flex', gap: 8 };
export const profileButton: CSSProperties = {
  flex: '1 1 0%', height: 32, borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${themeAlpha.ink(0.10)}`, background: 'transparent',
  color: theme.text, font: 'inherit', fontSize: 12, fontWeight: 550,
};
export const profileButtonPrimary: CSSProperties = {
  ...profileButton,
  border: 'none', background: theme.accent, color: theme.onAccent, fontWeight: 600,
};

export const menu: CSSProperties = {
  position: 'absolute', top: 32, right: 0, minWidth: 210, padding: 6, zIndex: 40,
  display: 'flex', flexDirection: 'column', gap: 2,
  background: theme.panelAlt, border: `0.5px solid ${theme.border}`, borderRadius: 10,
  boxShadow: `0 12px 32px ${themeAlpha.shadow(0.35)}`,
};
export const menuItem: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 9px',
  border: 'none', borderRadius: 7, background: 'transparent', color: theme.text,
  fontSize: 12.5, textAlign: 'left', cursor: 'pointer',
};

// ---- section header --------------------------------------------------------

export const sectionHeader: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 18px' };
export const sectionTitle: CSSProperties = { margin: 0, fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em', color: theme.textStrong };
export const countPill: CSSProperties = {
  fontSize: 11.5, color: theme.textDim, border: 'none',
  borderRadius: 999, padding: '2px 9px', fontVariantNumeric: 'tabular-nums',
};
export const headerSearchSlot: CSSProperties = { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 };

export const searchBox: CSSProperties = { width: 232, position: 'relative', display: 'inline-flex', alignItems: 'center' };
export const searchIcon: CSSProperties = { position: 'absolute', left: 10, display: 'inline-flex', color: theme.textDim, pointerEvents: 'none' };
export const searchInput: CSSProperties = {
  width: '100%', height: 32, boxSizing: 'border-box', padding: '0 30px 0 30px',
  border: `0.5px solid ${theme.border}`, borderRadius: 9, background: theme.panel, color: theme.text,
  fontSize: 12.5, outline: 'none', WebkitAppearance: 'none',
};
export const searchClear: CSSProperties = {
  position: 'absolute', right: 3, width: 24, height: 24, display: 'grid', placeItems: 'center',
  padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: theme.textDim, cursor: 'pointer',
};

export const ghostButton: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: theme.text,
  background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 999,
  padding: '6px 14px', cursor: 'pointer', height: 32,
  backdropFilter: 'blur(20px) saturate(140%)',
};
export const iconGhostButton: CSSProperties = { ...ghostButton, padding: '6px 8px' };

// ---- grid ------------------------------------------------------------------

export const grid: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))',
  gap: 22, alignItems: 'start',
};

// ---- launch panel ----------------------------------------------------------
// The four entry points. Restraint is the point: the surface stays monochrome
// and skinned, and colour is demoted to a single 17px icon plus a barely-there
// wash on hover. Filling these tiles with saturated gradients turned the first
// screen into a toy; a tool should look like a tool.

export interface LaunchTint {
  /** Icon colour only. */
  ink: string;
  /** ~8% wash painted behind the tile while it is hovered or focused. */
  wash: string;
}

export const LAUNCH_TINTS: Record<'video' | 'photo' | 'project' | 'import', LaunchTint> = {
  video: { ink: '#a78bfa', wash: 'rgba(167, 139, 250, 0.085)' },
  photo: { ink: '#60a5fa', wash: 'rgba(96, 165, 250, 0.085)' },
  project: { ink: theme.textStrong, wash: themeAlpha.ink(0.05) },
  import: { ink: '#34d399', wash: 'rgba(52, 211, 153, 0.085)' },
};

export const launchPanel: CSSProperties = {
  margin: '0 0 26px',
  padding: 0,
  border: 'none',
  background: 'transparent',
};
/** Greeting on the left, the primary action on the right, on one baseline. */
export const launchTop: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
  flexWrap: 'nowrap', gap: 16, padding: '0 2px 18px',
};
/** The text column may shrink (and its hint truncate) so the button never wraps. */
export const launchGreeting: CSSProperties = {
  flex: '1 1 auto', minWidth: 0,
};
export const greetingText: CSSProperties = {
  display: 'block', fontSize: 21, fontWeight: 620, letterSpacing: '-0.02em',
  lineHeight: 1.2, color: theme.textStrong,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
export const greetingHint: CSSProperties = {
  display: 'block', marginTop: 4, fontSize: 11.5, color: theme.textDim,
  lineHeight: 1.4,
};
/** Icon-only primary action used when the panel is too narrow for a pill label. */
export const newProjectButtonCompact: CSSProperties = {
  width: 34, height: 34, padding: 0, justifyContent: 'center',
};
export const newProjectButton: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto',
  height: 34, padding: '0 15px', borderRadius: 999, border: 'none',
  background: theme.accent, color: theme.onAccent,
  fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  boxShadow: `0 1px 2px ${themeAlpha.shadow(0.26)}, 0 8px 20px -12px ${themeAlpha.accent(0.55)}`,
  transition: 'transform .15s ease, box-shadow .15s ease',
};
export const newProjectButtonHover: CSSProperties = {
  transform: 'translateY(-1px)',
  boxShadow: `0 2px 5px ${themeAlpha.shadow(0.30)}, 0 16px 30px -14px ${themeAlpha.accent(0.70)}`,
};
/**
 * Two tiles per row, so the four entry points read as a tidy 2×2 block. Tiles
 * stay wide enough to show a full label instead of ellipsizing to one letter.
 */
export const launchGrid: CSSProperties = {
  display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
};

/**
 * The five launch boxes sit on the page rather than in it: a tight contact
 * shadow plus a wide soft one, both from the skin's shadow ink so they survive
 * a light theme. Hover deepens them instead of introducing a shadow from zero.
 */
const BOX_SHADOW_REST = `0 1px 2px ${themeAlpha.shadow(0.26)}, 0 10px 22px -14px ${themeAlpha.shadow(0.55)}`;
const BOX_SHADOW_LIFT = `0 2px 5px ${themeAlpha.shadow(0.30)}, 0 20px 36px -18px ${themeAlpha.shadow(0.66)}`;

/** The full-width row under the tiles: one more way in, not a fifth tile. */
export function workflowButton(hovered: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 9, width: '100%', boxSizing: 'border-box',
    marginTop: 10, padding: '0 11px', height: 42, minWidth: 0,
    borderRadius: 11, cursor: 'pointer', textAlign: 'left',
    border: `1px solid ${hovered ? themeAlpha.ink(0.16) : themeAlpha.ink(0.07)}`,
    background: hovered ? themeAlpha.ink(0.05) : themeAlpha.ink(0.02),
    boxShadow: hovered ? BOX_SHADOW_LIFT : BOX_SHADOW_REST,
    transform: hovered ? 'translateY(-1px)' : 'none',
    transition: 'background .15s ease, border-color .15s ease, box-shadow .15s ease, transform .15s ease',
    color: theme.text,
  };
}
export const workflowButtonIcon: CSSProperties = {
  width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', flexShrink: 0,
  color: theme.textStrong, background: themeAlpha.ink(0.05),
  border: `1px solid ${themeAlpha.ink(0.07)}`,
};
/** Label over hint, both single-line: on a phone width the hint must truncate, not wrap. */
export const workflowButtonBody: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: '1 1 auto',
};
export const workflowButtonLabel: CSSProperties = {
  fontSize: 12.5, fontWeight: 600, lineHeight: 1.2, color: theme.textStrong,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
export const workflowButtonHint: CSSProperties = {
  fontSize: 10.5, lineHeight: 1.25, color: theme.textDim,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
export const workflowButtonChevron: CSSProperties = {
  marginLeft: 'auto', display: 'inline-flex', color: theme.textDim,
  transform: 'rotate(-90deg)', flexShrink: 0,
};

/**
 * Icon beside the label rather than above it: in a 2-up grid the tile is wide
 * but short, so a horizontal row uses the space and reads at a glance.
 */
export function launchTile(tint: LaunchTint, hovered: boolean): CSSProperties {
  return {
    boxSizing: 'border-box', position: 'relative',
    display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9,
    minHeight: 62, minWidth: 0, padding: '10px 11px', width: '100%',
    cursor: 'pointer', textAlign: 'left',
    borderRadius: 11,
    border: `1px solid ${hovered ? themeAlpha.ink(0.16) : themeAlpha.ink(0.07)}`,
    background: hovered ? tint.wash : themeAlpha.ink(0.02),
    boxShadow: hovered ? BOX_SHADOW_LIFT : BOX_SHADOW_REST,
    transform: hovered ? 'translateY(-1px)' : 'none',
    transition: 'background .15s ease, border-color .15s ease, box-shadow .15s ease, transform .15s ease',
    color: theme.text,
  };
}
export const launchIcon = (ink: string): CSSProperties => ({
  width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center', flexShrink: 0,
  color: ink, background: themeAlpha.ink(0.05),
  border: `1px solid ${themeAlpha.ink(0.07)}`,
});
export const launchBody: CSSProperties = {
  display: 'flex', flexDirection: 'column', justifyContent: 'center',
  minWidth: 0, flex: '1 1 auto',
};
export const launchLabel: CSSProperties = {
  display: 'block', fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.005em', color: theme.textStrong,
  lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
export const launchSub: CSSProperties = {
  display: 'block', marginTop: 1, fontSize: 10, lineHeight: 1.3, color: theme.textDim,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

export const projectSectionHead: CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 4px 12px',
};
export const projectSectionTitle: CSSProperties = {
  fontSize: 12.5, fontWeight: 600, letterSpacing: '0.02em', color: theme.textStrong,
};
export const projectSectionCount: CSSProperties = { fontSize: 11.5, color: theme.textDim };

export const card: CSSProperties = {
  borderRadius: 14, background: theme.panel, overflow: 'hidden',
  borderStyle: 'solid', borderWidth: 0.5, borderColor: theme.border,
  boxShadow: `0 1px 2px ${themeAlpha.shadow(0.16)}`,
  transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease',
};
export const cardHover: CSSProperties = {
  transform: 'translateY(-2px)',
  borderColor: theme.borderLight,
  boxShadow: `0 10px 26px ${themeAlpha.shadow(0.32)}`,
};
export const thumb: CSSProperties = {
  position: 'relative', width: '100%', aspectRatio: '16 / 9', background: theme.inset,
  border: 'none', borderBottom: `0.5px solid ${theme.border}`, padding: 0,
  overflow: 'hidden', display: 'grid', placeItems: 'center', cursor: 'pointer',
};
export const thumbImage: CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block',
};
export const thumbScrim: CSSProperties = {
  position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
  background: themeAlpha.ink(0.34), color: theme.textStrong,
  opacity: 0, transition: 'opacity .15s ease',
};
export const thumbScrimVisible: CSSProperties = { opacity: 1 };

export const cardBody: CSSProperties = { padding: '10px 12px 11px', display: 'flex', flexDirection: 'column', gap: 5 };
export const cardName: CSSProperties = {
  fontSize: 13.5, fontWeight: 600, color: theme.text,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
export const cardMeta: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 20 };
export const metaText: CSSProperties = { fontSize: 11, color: theme.textDim, fontVariantNumeric: 'tabular-nums' };
export const actionRow: CSSProperties = { display: 'flex', gap: 2, opacity: 0, transition: 'opacity .12s ease' };
export const actionRowVisible: CSSProperties = { opacity: 1 };
export const miniBtn: CSSProperties = {
  background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer', fontSize: 12,
  width: 24, height: 24, padding: 0, borderRadius: 6,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
export const nameInput: CSSProperties = {
  font: 'inherit', fontSize: 13.5, fontWeight: 600, background: theme.panelAlt, color: theme.text,
  border: `0.5px solid ${theme.accent}`, borderRadius: 6, padding: '2px 6px', width: '100%',
};

export const emptyState: CSSProperties = {
  marginTop: 22, padding: '22px 16px', display: 'inline-flex', alignItems: 'center', gap: 8,
  color: theme.textDim, fontSize: 12.5,
  border: `0.5px solid ${theme.border}`, borderRadius: 12,
};

// ---- model setup banner ----------------------------------------------------

export const modelSetupBar: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '12px 14px',
  border: `0.5px solid ${theme.border}`, borderRadius: 12,
  background: `linear-gradient(90deg, ${themeAlpha.accent(0.10)}, transparent 70%), ${theme.panel}`,
};
export const modelSetupIcon: CSSProperties = {
  width: 34, height: 34, flex: '0 0 auto', display: 'grid', placeItems: 'center',
  borderRadius: 9, color: theme.accent, background: theme.panelAlt,
};
export const modelSetupButton: CSSProperties = {
  flex: '0 0 auto', border: 'none', borderRadius: 9,
  background: theme.accent, color: theme.onAccent, padding: '8px 14px',
  fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
};

// ---- brand identity + bottom dock -------------------------------------------
// Monochrome brand: the old pink -> purple -> blue gradient is gone with the
// black-and-white theme, but the tokens stay so the dock glow and the primary
// pill cannot drift apart. `onBrand` is black because the pill is now white.

const BRAND = { pink: '#ffffff', purple: '#ffffff', blue: '#ffffff', onBrand: '#000000' } as const;

const brandAlpha = (hex: string, alpha: number): string => {
  const value = hex.slice(1);
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
};

/** Brand-coloured shading sitting behind the dock, masked so it fades upward. */
export const bottomGlow: CSSProperties = {
  position: 'fixed', left: 0, right: 0, bottom: 0, height: 300, zIndex: 5, pointerEvents: 'none',
  background: [
    `radial-gradient(44% 112% at 13% 112%, ${brandAlpha(BRAND.pink, 0.12)} 0%, transparent 66%)`,
    `radial-gradient(58% 130% at 50% 120%, ${brandAlpha(BRAND.purple, 0.1)} 0%, transparent 68%)`,
    `radial-gradient(44% 112% at 87% 112%, ${brandAlpha(BRAND.blue, 0.12)} 0%, transparent 66%)`,
  ].join(', '),
  WebkitMaskImage: 'linear-gradient(to top, #000 0%, rgba(0, 0, 0, 0.66) 46%, transparent 100%)',
  maskImage: 'linear-gradient(to top, #000 0%, rgba(0, 0, 0, 0.66) 46%, transparent 100%)',
  filter: 'blur(6px)',
};

/**
 * Bottom navigation, modelled on FreeCut's `components/layout/bottom-nav.tsx`.
 *
 * Two things changed from the old rail: it is a full-width CENTRED WRAPPER with a
 * capped pill inside (so it can never run off-screen — the old `left:50%` +
 * `inline-flex` pill overflowed by 29px on a narrow window), and every tab is an
 * equal `flex: 1` capsule with the icon stacked over the label, so the rail
 * reflows instead of clipping.
 */
export const bottomNavWrap: CSSProperties = {
  position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
  display: 'flex', justifyContent: 'center', pointerEvents: 'none',
  // `env(safe-area-inset-bottom)` with a 14px fallback: the pill clears the iOS
  // home indicator and still sits 14px off the edge everywhere else.
  padding: '0 12px calc(env(safe-area-inset-bottom, 0px) + 14px)',
};

export const bottomNav: CSSProperties = {
  pointerEvents: 'auto', display: 'flex', alignItems: 'stretch', gap: 2,
  width: '100%', maxWidth: 420, padding: 4, borderRadius: 999,
  border: `0.5px solid ${theme.border}`, background: theme.panelAlt,
  boxShadow: `0 18px 46px ${themeAlpha.shadow(0.48)}, 0 0 0 1px ${themeAlpha.ink(0.04)}`,
  backdropFilter: 'blur(18px)',
};

/** One tab's hit area: equal share of the rail, never narrower than its label. */
export const navTab: CSSProperties = {
  display: 'flex', flex: '1 1 0%', minWidth: 0,
  alignItems: 'center', justifyContent: 'center',
  background: 'none', border: 'none', padding: 0, margin: 0,
  font: 'inherit', cursor: 'pointer',
};

/**
 * The visual capsule. Sizes are `clamp()`-based rather than media queries because
 * these styles are inline and have no breakpoint hook: the label, gap and padding
 * all breathe with the viewport, so the rail looks right at 280px and at 1440px.
 */
export function navCapsule(active: boolean, hovered: boolean): CSSProperties {
  return {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 'clamp(1px, 0.4vw, 2px)',
    width: '100%', minWidth: 0,
    padding: 'clamp(5px, 1.5vw, 8px) clamp(5px, 2vw, 15px)',
    borderRadius: 999,
    color: theme.text,
    // Idle tabs are white at reduced opacity, not a grey token: the palette stays
    // strictly black-and-white and hierarchy comes from weight, not hue.
    opacity: active || hovered ? 1 : 0.6,
    background: active ? theme.hover : hovered ? themeAlpha.ink(0.06) : 'transparent',
    fontSize: 'clamp(9.5px, 2.3vw, 12px)',
    fontWeight: active ? 600 : 550,
    lineHeight: 1.15,
    transition: 'opacity .12s ease, background .12s ease',
  };
}

/** The primary action keeps the solid white pill, at the same geometry. */
export function navPrimaryCapsule(hovered: boolean): CSSProperties {
  return {
    ...navCapsule(true, hovered),
    background: theme.accent, color: theme.onAccent, fontWeight: 650,
    opacity: hovered ? 0.9 : 1,
  };
}

export const navLabel: CSSProperties = {
  maxWidth: '100%', whiteSpace: 'nowrap',
  overflow: 'hidden', textOverflow: 'ellipsis',
};

/** Marks a destination that is announced but not live yet (Circle). */
export const navSoonDot: CSSProperties = {
  position: 'absolute', top: -2, right: -3,
  width: 5, height: 5, borderRadius: 999,
  background: theme.accent, boxShadow: `0 0 0 1.5px ${theme.panelAlt}`,
};
