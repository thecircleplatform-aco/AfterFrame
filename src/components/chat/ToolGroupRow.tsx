import { useState } from 'react';
import { useT } from '../../i18n/locale';
import { ChatMessage } from './ChatMessage';
import { ToolBadge, toolAccent, toolIcon } from './ToolBadge';
import type { DisplayMessage } from '../../agent/agent-session';

// Collapsed row for a run of same-name tool calls: "● edit_gap · 20 times ▸".
// Click to expand the individual rows (each keeps its own arg summary). Mirrors
// the single tool-row look in ChatMessage so the collapsed/expanded states match.
export function ToolGroupRow({ name, items, onOpenSettings }: { name: string; items: { msg: DisplayMessage; index: number }[]; onOpenSettings?: ((route?: string) => void) | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anyError = items.some(({ msg }) => {
    const r = msg.tool?.result as Record<string, unknown> | undefined;
    return !!r && 'error' in r;
  });
  const anyRunning = items.some(({ msg }) => !msg.tool?.result);
  return (
    <div className="cc-tool-row cc-tool-group">
      <button
        type="button"
        className="cc-tool-row-head"
        onClick={() => setOpen((o) => !o)}
        title={open ? t('Collapse') : t('Expand all')}
        aria-expanded={open}
      >
        <ToolBadge state={anyRunning ? 'running' : anyError ? 'error' : 'done'} accent={toolAccent(name)} icon={toolIcon(name)} />
        <span className="cc-tool-row-name">{name}</span>
        <span className="cc-tool-row-count">{t('{n} calls', { n: items.length })}</span>
        <span className={`cc-tool-row-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </span>
      </button>
      {open && (
        <div className="cc-tool-row-nest">
          {items.map(({ msg, index }) => (
            <ChatMessage key={index} msg={msg} onOpenSettings={onOpenSettings} />
          ))}
        </div>
      )}
    </div>
  );
}
