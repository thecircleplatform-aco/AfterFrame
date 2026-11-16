import type { CSSProperties } from 'react';
import { theme, themeAlpha } from '../../theme';
import { ON } from './settingsVendorPane.styles';

const TREE_WIDTH = 200;
const VENDOR_COL_WIDTH = 185;

/**
 * Below this the three columns cannot coexist without squeezing each other, so
 * the dialog switches to one pane at a time (drill-down) and goes full-screen.
 * 200 + 185 + a readable content column plus padding is the real floor.
 */
export const COMPACT_BREAKPOINT = 760;

export function navRowStyle(active: boolean, hovered: boolean): CSSProperties {
  return {
    font: 'inherit', fontSize: 12, display: 'flex', alignItems: 'center', gap: 7,
    width: '100%', padding: '6px 9px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
    border: 'none', borderLeft: `2px solid ${active ? theme.accent : 'transparent'}`,
    background: active || hovered ? theme.panelAlt : 'transparent',
    color: active ? theme.text : theme.textDim,
  };
}

export function dot(on: boolean): CSSProperties {
  return {
    width: 7, height: 7, borderRadius: '50%',
    background: on ? ON : theme.borderLight, flex: '0 0 auto',
  };
}

export const overlay: CSSProperties = {
  position: 'fixed', inset: 0, background: themeAlpha.shadow(0.62), display: 'grid', placeItems: 'center',
  zIndex: 200, padding: 24, fontFamily: 'var(--cc-font)',
};
export const panel: CSSProperties = {
  width: 'min(940px, 100%)', height: 'min(640px, 86vh)', display: 'flex', flexDirection: 'column',
  background: theme.panel, color: theme.text, border: `0.5px solid ${theme.border}`, borderRadius: 6,
  boxShadow: `0 24px 64px ${themeAlpha.shadow(0.5)}`, overflow: 'hidden',
};
export const head: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'column',
  padding: '10px 12px', background: 'transparent', borderBottom: 'none',
  position: 'relative', zIndex: 2,
};

/** The floating row across the top. It has no surface of its own — the back
 *  circle, the search capsule and the close circle each carry their own glass
 *  so they read as three separate controls hovering over the panel. */
export const headBar: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0,
};

/** Round glass button (back / close) at either end of the row. */
export const headIconBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 36, height: 36, padding: 0, borderRadius: 999, cursor: 'pointer',
  border: `0.5px solid ${theme.border}`, background: themeAlpha.ink(0.06),
  color: theme.textDim, flex: '0 0 auto',
  boxShadow: `0 10px 28px ${themeAlpha.shadow(0.45)}`,
  backdropFilter: 'blur(18px) saturate(1.35)',
  WebkitBackdropFilter: 'blur(18px) saturate(1.35)',
};

/** Glass capsule search field between the two circles. */
export const searchCapsule: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 0%', minWidth: 0,
  height: 36, padding: '0 12px', borderRadius: 999,
  background: themeAlpha.ink(0.06), color: theme.textDim,
  border: `0.5px solid ${theme.border}`,
  boxShadow: `0 10px 28px ${themeAlpha.shadow(0.45)}`,
  backdropFilter: 'blur(18px) saturate(1.35)',
  WebkitBackdropFilter: 'blur(18px) saturate(1.35)',
};
export const searchInput: CSSProperties = {
  flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
  color: theme.text, font: 'inherit', fontSize: 12.5, padding: 0,
};

/** Tiny clear button that appears inside the search capsule once typing starts. */
export const searchClear: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 18, height: 18, padding: 0, borderRadius: 999, cursor: 'pointer',
  border: 'none', background: 'transparent', color: theme.textDim, flex: '0 0 auto',
};

/** Glass capsule that takes the search field's place on a provider page: the
 *  provider mark and its connection state, centred in the same slot. The tint
 *  itself comes from `.cc-pane-tag[data-state]` in index.css. */
export const paneCapsule: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  flex: '1 1 0%', minWidth: 0, height: 36, padding: '0 14px', borderRadius: 999,
  fontSize: 12, fontWeight: 600,
  backdropFilter: 'blur(18px) saturate(1.35)',
  WebkitBackdropFilter: 'blur(18px) saturate(1.35)',
};
export const bodyRow: CSSProperties = { display: 'flex', flex: 1, minHeight: 0 };
export const sidebar: CSSProperties = {
  width: TREE_WIDTH, flex: '0 0 auto', display: 'flex', flexDirection: 'column',
  borderRight: `0.5px solid ${theme.border}`, overflow: 'hidden',
};
export const treeScroll: CSSProperties = {
  flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex',
  flexDirection: 'column', gap: 2, padding: '10px 8px',
};
export const catRow: CSSProperties = {
  font: 'inherit', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
  width: '100%', padding: '7px 9px 7px 7px', borderRadius: 6, cursor: 'pointer',
  border: 'none', background: 'transparent', color: theme.text,
};
export const chevronBox: CSSProperties = {
  display: 'inline-flex', color: theme.textDim, transition: 'transform 0.15s', flex: '0 0 auto',
};
export const navLabel: CSSProperties = {
  flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
export const vendorCol: CSSProperties = {
  width: VENDOR_COL_WIDTH, flex: '0 0 auto', minWidth: 0, minHeight: 0, overflowY: 'auto',
  display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 8px',
  borderRight: `0.5px solid ${theme.border}`,
};
export const routeBox: CSSProperties = {
  padding: '0 2px 10px', marginBottom: 6, borderBottom: `0.5px solid ${theme.border}`,
};
export const foot: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
  borderTop: 'none', background: 'transparent', position: 'relative', zIndex: 3,
};

/** Floating disclosure dot that hides the advanced footer items from users who
 *  do not need them. Ownership of the shadow keeps it legible without a bar. */
export const footToggle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, padding: 0, borderRadius: 999, cursor: 'pointer',
  border: 'none', background: 'transparent', color: theme.textDim,
  boxShadow: `0 6px 18px ${themeAlpha.shadow(0.45)}`, flex: '0 0 auto',
};

/** Popover that floats above the footer with the advanced controls. */
export const advPanel: CSSProperties = {
  position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 8,
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
  padding: 8, borderRadius: 12, background: theme.panel,
  border: `0.5px solid ${theme.border}`,
  boxShadow: `0 18px 44px ${themeAlpha.shadow(0.6)}`, whiteSpace: 'nowrap',
};
export const footMsg: CSSProperties = {
  flex: 1, minWidth: 0, textAlign: 'right', fontSize: 11.5,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
export const revealLabel: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5,
  padding: '5px 11px', borderRadius: 999, border: 'none', background: 'transparent',
  color: theme.textDim, cursor: 'pointer', userSelect: 'none', flex: '0 0 auto',
  boxShadow: `0 6px 18px ${themeAlpha.shadow(0.35)}`,
};
export const licenseLink: CSSProperties = {
  color: theme.textDim, fontSize: 11.5, textDecoration: 'none',
  padding: '5px 11px', borderRadius: 999, border: 'none', background: 'transparent',
  flex: '0 0 auto', boxShadow: `0 6px 18px ${themeAlpha.shadow(0.35)}`,
};
export const btnGhost: CSSProperties = {
  font: 'inherit', fontSize: 12.5, background: 'transparent', color: theme.text,
  border: `0.5px solid ${theme.border}`, borderRadius: 999, padding: '6px 15px', cursor: 'pointer',
  flex: '0 0 auto', boxShadow: `0 10px 26px ${themeAlpha.shadow(0.45)}`,
};
export const btnPrimary: CSSProperties = {
  font: 'inherit', fontSize: 12.5, fontWeight: 600, background: theme.text,
  color: theme.bg, border: 'none', borderRadius: 999, padding: '7px 18px', flex: '0 0 auto',
  boxShadow: `0 10px 28px ${themeAlpha.shadow(0.55)}`,
};

/** Hairline pill that names the pane the capsule just drilled into. It has no
 *  own background — it floats over the panel like the close button does. The
 *  connected/disconnected wash lives in index.css (.cc-pane-tag[data-state]). */
export const paneTag: CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: theme.textDim,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
  padding: '5px 10px', borderRadius: 999,
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

// ── Responsive variants ───────────────────────────────────────────────────
//
// The wide layout is three fixed columns. On a narrow window those columns keep
// their widths and the content column is what gets eaten — at ~306px the whole
// dialog was unusable. Compact renders ONE pane at a time at full width, so
// every screen size gets a readable column instead of three squeezed ones.

export function overlayStyle(compact: boolean): CSSProperties {
  return compact ? { ...overlay, padding: 0, placeItems: 'stretch' } : overlay;
}

export function panelStyle(compact: boolean): CSSProperties {
  return compact
    ? {
        ...panel,
        width: '100%',
        // 100% of the fixed-inset overlay, which is exactly the viewport. `dvh`
        // is added for browsers that report a larger vh with mobile chrome, but
        // `100%` is what keeps this correct everywhere.
        height: '100%',
        maxHeight: '100%',
        borderRadius: 0,
        border: 'none',
      }
    : { ...panel, maxHeight: '100%' };
}

export function headStyle(compact: boolean): CSSProperties {
  return compact
    ? { ...head, padding: '10px 12px' }
    : head;
}

export function bodyRowStyle(compact: boolean): CSSProperties {
  return compact ? { ...bodyRow, flexDirection: 'column' } : bodyRow;
}

export function sidebarStyle(compact: boolean): CSSProperties {
  return compact
    // In column mode a fixed-width column has no height, so it must both grow
    // and be allowed to shrink — otherwise it overflows under the footer.
    ? { ...sidebar, width: '100%', borderRight: 'none', flex: '1 1 0%', minHeight: 0 }
    : sidebar;
}

export function vendorColStyle(compact: boolean): CSSProperties {
  return compact
    ? { ...vendorCol, width: '100%', borderRight: 'none', flex: '1 1 0%', minHeight: 0 }
    : vendorCol;
}

export function footStyle(compact: boolean): CSSProperties {
  return compact
    ? { ...foot, flexWrap: 'wrap', padding: '10px 12px' }
    : foot;
}

/** The "back to …" strip that only exists in the compact drill-down. */
export const paneBar: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto',
  padding: '7px 10px', borderBottom: `0.5px solid ${theme.border}`,
};

export const backBtn: CSSProperties = {
  ...navRowStyle(false, false), width: 'auto', flex: '0 0 auto', padding: '4px 8px',
};
