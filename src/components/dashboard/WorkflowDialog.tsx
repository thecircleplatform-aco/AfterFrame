// Dashboard entry point for the agent's professional workflows (the same skills
// the editor's composer offers in WorkflowPickerContent). Picking one creates a
// project with that workflow already active, so the choice survives the jump
// into the editor: it is persisted per project by saveCreativeMode.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { allCreativeSkills } from '../../agent/skills/skills-catalog';
import { localizedCatalogText, useT } from '../../i18n/locale';
import { Icon } from '../../modules/icons';
import { theme, themeAlpha } from '../../theme';

export function WorkflowDialog({
  onPick,
  onClose,
}: {
  onPick: (workflowId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [hovered, setHovered] = useState<string | null>(null);
  // `skill-creator` is a meta skill for authoring skills, not an editing plan,
  // so it does not belong in a list of ways to cut a video.
  const skills = allCreativeSkills().filter((skill) => skill.slug !== 'skill-creator');

  return (
    <div style={overlay} onClick={onClose}>
      <div role="dialog" aria-label={t('Workflow')} style={panel} onClick={(event) => event.stopPropagation()}>
        <header style={head}>
          <span style={{ color: theme.textStrong, display: 'inline-flex' }}><Icon name="wand" size={15} /></span>
          <b style={{ fontSize: 13.5 }}>{t('Workflow')}</b>
          <span style={headHint}>{t('Pick how the agent plans the edit')}</span>
          <button type="button" onClick={onClose} aria-label={t('Close')} style={closeButton}>
            <Icon name="x" size={14} />
          </button>
        </header>

        <div style={list}>
          {skills.map((skill) => {
            const lit = hovered === skill.id;
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => onPick(skill.id)}
                onMouseEnter={() => setHovered(skill.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(skill.id)}
                onBlur={() => setHovered(null)}
                style={{ ...row, ...(lit ? rowHover : null) }}
              >
                <span style={rowBody}>
                  <span style={rowName}>{localizedCatalogText(skill.name, skill.nameZh)}</span>
                  <span style={rowBlurb}>{localizedCatalogText(skill.description, skill.summary)}</span>
                </span>
                <span aria-hidden="true" style={{ ...rowChevron, opacity: lit ? 1 : 0.35 }}>
                  <Icon name="chevronDown" size={14} />
                </span>
              </button>
            );
          })}
        </div>

        <footer style={foot}>
          {t('A new project opens with the workflow active')}
        </footer>
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 120, background: themeAlpha.shadow(0.55),
  display: 'grid', placeItems: 'center',
};
const panel: CSSProperties = {
  width: 620, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 96px)',
  display: 'flex', flexDirection: 'column',
  background: theme.panel, border: `0.5px solid ${theme.borderLight}`, borderRadius: 12,
  boxShadow: `0 24px 64px ${themeAlpha.shadow(0.5)}`, color: theme.text,
};
const head: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px',
  borderBottom: `0.5px solid ${theme.border}`,
};
const headHint: CSSProperties = { color: theme.textDim, fontSize: 12 };
const closeButton: CSSProperties = {
  marginLeft: 'auto', background: 'none', border: 'none', padding: 6, borderRadius: 6,
  color: theme.textDim, cursor: 'pointer', display: 'inline-flex',
};
const list: CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 };
const row: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
  padding: '10px 12px', borderRadius: 8, border: '1px solid transparent',
  background: 'transparent', color: theme.text, cursor: 'pointer',
  transition: 'background .14s ease, border-color .14s ease',
};
const rowHover: CSSProperties = {
  background: themeAlpha.ink(0.05), borderColor: themeAlpha.ink(0.09),
};
const rowBody: CSSProperties = { display: 'block', flex: 1, minWidth: 0 };
const rowName: CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, color: theme.textStrong,
};
const rowBlurb: CSSProperties = {
  display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
  overflow: 'hidden', marginTop: 3, fontSize: 11.5, lineHeight: 1.5, color: theme.textDim,
};
const rowChevron: CSSProperties = {
  flexShrink: 0, display: 'inline-flex', color: theme.textDim,
  transform: 'rotate(-90deg)', transition: 'opacity .14s ease',
};
const foot: CSSProperties = {
  padding: '10px 16px', borderTop: `0.5px solid ${theme.border}`,
  color: theme.textDim, fontSize: 11.5,
};
