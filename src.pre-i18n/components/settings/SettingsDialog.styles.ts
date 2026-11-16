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
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 12px', background: 'transparent', borderBottom: 'none',
  position: 'relative', zIndex: 2,
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
export const sidebarNote: CSSProperties = {
  margin: 0, padding: '10px 12px', fontSize: 10.5, lineHeight: 1.6,
  color: theme.textDim, borderTop: `0.5px solid ${theme.border}`,
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
  borderTop: `0.5px solid ${theme.border}`, background: theme.panel,
};
export const footMsg: CSSProperties = {
  flex: 1, minWidth: 0, textAlign: 'right', fontSize: 11.5,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
export const revealLabel: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5,
  padding: '5px 11px', borderRadius: 999, border: `0.5px solid ${theme.border}`,
  color: theme.textDim, cursor: 'pointer', userSelect: 'none', flex: '0 0 auto',
};
export const licenseLink: CSSProperties = {
  color: theme.textDim, fontSize: 11.5, textDecoration: 'none',
  padding: '5px 11px', borderRadius: 999, border: `0.5px solid ${theme.border}`,
  flex: '0 0 auto',
};
export const iconBtn: CSSProperties = {
  background: 'transparent', border: 'none', color: theme.textDim,
  cursor: 'pointer', padding: 5, borderRadius: 999, display: 'inline-flex', flex: '0 0 auto',
};
export const btnGhost: CSSProperties = {
  font: 'inherit', fontSize: 12.5, background: 'transparent', color: theme.text,
  border: `0.5px solid ${theme.border}`, borderRadius: 999, padding: '6px 15px', cursor: 'pointer',
  flex: '0 0 auto',
};
export const btnPrimary: CSSProperties = {
  font: 'inherit', fontSize: 12.5, fontWeight: 600, background: theme.text,
  color: theme.bg, border: 'none', borderRadius: 999, padding: '7px 18px', flex: '0 0 auto',
};

/**
 * The capsule back control that lives INSIDE the header (compact drill-down), so
 * the dialog has one bar at the top instead of a header plus a second strip.
 */
export const backCapsule: CSSProperties = {
  font: 'inherit', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '5px 12px 5px 9px', borderRadius: 999, cursor: 'pointer',
  border: `0.5px solid ${theme.border}`, background: theme.panelAlt, color: theme.text,
  maxWidth: 240, minWidth: 0, flex: '0 1 auto',
};

/** Hairline pill that names the pane the capsule just drilled into. It has no
 *  own background — it floats over the panel like the close button does. */
export const paneTag: CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: theme.textDim,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
  padding: '5px 10px', borderRadius: 999, background: 'transparent',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
export const code: CSSProperties = {
  fontFamily: 'ui-monospace, monospace', fontSize: 10,
  background: theme.panelAlt, padding: '1px 4px', borderRadius: 4,
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
    ? { ...head, flexWrap: 'wrap', rowGap: 6, columnGap: 10, padding: '10px 12px' }
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
    ? { ...foot, flexWrap: 'wrap', rowGap: 8, columnGap: 8, padding: '10px 12px' }
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
