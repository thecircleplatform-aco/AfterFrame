import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Message, type KiteTheme } from '@kitelus/fly-ui';
import { theme, themeAlpha } from '../../theme';
import { Icon } from '../../modules/icons';
import { useT } from '../../i18n/locale';
import type { AgentRetry, DisplayMessage } from '../../agent/agent-session';
import { parseWidgets } from './widget-parse';
import { parsePlans, type AssistantSegment, type PlanStep } from './plan-parse';
import { PlanCard } from './PlanCard';
import { WidgetCard } from './WidgetCard';
import { Markdown } from './Markdown';
import { ToolBadge, toolAccent, toolIcon, THINK_ACCENT, type ToolBadgeState } from './ToolBadge';

/** Honour the OS motion preference once, at module scope (it cannot change mid-render). */
const prefersReducedMotion = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The kit's tokens mapped onto AfterFrame's palette, so the bubble belongs to
 * this app rather than looking like an embedded widget.
 */
const chatMessageTheme: KiteTheme = {
  primary: theme.accent,
  primaryForeground: theme.onAccent,
  primarySubtle: themeAlpha.accent(0.14),
  foreground: theme.text,
  muted: theme.textDim,
  subtle: themeAlpha.ink(0.45),
  background: 'transparent',
  surface: theme.hover,
  surfaceMuted: theme.panelAlt,
  surfaceElevated: theme.panelAlt,
  border: themeAlpha.ink(0.1),
  borderSubtle: themeAlpha.ink(0.07),
  danger: theme.danger,
  success: theme.success,
  radius: '10px',
  radiusSm: '8px',
  radiusLg: '14px',
};

// Take the "most distinguishable" one from the tool parameters to make an in-line summary - sort by identification: first identify it specifically
// (query/itemId/name...), then generalize (action/target...). Make multiple calls with the same name identifiable at a glance and no longer look like repetitions.
const SUMMARY_KEYS = ['query', 'itemId', 'templateName', 'audioName', 'name', 'from', 'to', 'templateId', 'category', 'ratio', 'action', 'format', 'target', 'track', 'renderId'];
function toolArgSummary(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  for (const k of SUMMARY_KEYS) {
    const v = a[k];
    if (v === undefined || v === null || v === '') continue;
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (k === 'itemId' || k === 'templateId' || k === 'renderId') s = s.slice(0, 8); // uuid only takes the first 8
    if (s.length > 26) s = s.slice(0, 24) + '…';
    return s;
  }
  return '';
}

// Collapsed "Thinking Process" block — native thinking flow and inline <thinking> extractions go here
// (Both are folded into thinking blocks, folded by default).
function ThinkingBlock({ text, active = false }: { text: string; active?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 6 }}>
      <button onClick={() => setOpen((v) => !v)} title={open ? t('Collapse reasoning') : t('Expand reasoning')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.text, fontSize: 12, fontWeight: 500, padding: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
        <ToolBadge state={active ? 'running' : 'done'} accent={THINK_ACCENT} icon="brain" size={16} />
        {t('Reasoning')}
        <span style={{ display: 'inline-flex', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', opacity: 0.7 }}>▸</span>
      </button>
      {open && (
        /* Reasoning is supporting context, not output: no framed box, no italic.
           A faint left rail keeps it visually grouped under the toggle, and the
           text sits at reduced opacity so it recedes behind the real answer. */
        <div style={{ marginTop: 6, marginLeft: 3, paddingLeft: 11, borderLeft: `1px solid ${theme.border}`, opacity: 0.55 }}>
          <Markdown text={text} style={{ fontSize: 11.5, lineHeight: 1.55 }} />
        </div>
      )}
    </div>
  );
}

interface ChatMessageProps {
  msg: DisplayMessage;
  /** the actively-streaming assistant turn hides the copy button until done */
  streaming?: boolean;
  /** true while any agent run is in flight; disables the retry button */
  running?: boolean;
  /** A resend action for this user turn, shown below the user's message. */
  retry?: AgentRetry;
  onRetry?: ((retry: AgentRetry) => void) | null;
  /**
   * Re-send the turn with different text. Opens the composer prefilled with this
   * message instead of sending straight away.
   */
  onEdit?: ((retry: AgentRetry) => void) | null;
  /** How many later exchanges this turn would discard if re-sent. */
  laterTurns?: number;
  /** After the user fills out the <widget> form card and submits it, the assembled answer text is returned.*/
  onWidgetSubmit?: (answer: string) => void;
  widgetSubmitted?: boolean;
  /**
   * The same widget is being answered in the stepper docked above the composer.
   * Render a one-line pointer instead of a second identical form.
   */
  widgetDocked?: boolean;
  /** maxTurns pauses the card "continue"; only the last continue card can be clicked (the old card is read-only)*/
  onContinue?: (() => void) | null;
  /**
   * Run a plan the model proposed. Absent on read-only hosts, in which case plan
   * blocks fall back to plain markdown rather than showing a dead button.
   */
  onPlanRun?: ((steps: PlanStep[]) => void) | null;
  /** Open settings, optionally on a specific vendor page (used by the missing-model-pack action button). */
  onOpenSettings?: ((route?: string) => void) | null;
}

function isMissingModelPacksResult(result: unknown): boolean {
  return !!result && typeof result === 'object' && (result as Record<string, unknown>).action === 'missing-model-packs';
}

/**
 * Overflow actions under a sent message. Retry used to be the only one, which
 * made it look like a plain reload button; the destructive part (rewinding the
 * conversation and rolling back the agent's timeline edits) was invisible.
 * Collapsing the actions behind "More" also keeps the transcript quiet.
 */
function UserMessageActions({
  retry, running, laterTurns, onRetry, onEdit,
}: {
  retry: AgentRetry;
  running: boolean;
  laterTurns: number;
  onRetry: (retry: AgentRetry) => void;
  onEdit?: ((retry: AgentRetry) => void) | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const destructive = laterTurns > 0;

  return (
    <div className="cc-user-actions" ref={ref}>
      <button type="button" className="cc-user-actions-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open} aria-haspopup="menu"
        title={t('More options')} aria-label={t('More options')}>
        <Icon name="more" size={14} />
      </button>
      {open && (
        <div className="cc-user-actions-menu" role="menu">
          {onEdit && (
            <button type="button" role="menuitem" className="cc-user-actions-item"
              disabled={running}
              onClick={() => { setOpen(false); onEdit(retry); }}>
              <Icon name="pencil" size={13} />
              <span>{t('Edit and resend')}</span>
            </button>
          )}
          <button type="button" role="menuitem"
            className={`cc-user-actions-item${destructive ? ' is-destructive' : ''}`}
            disabled={running}
            onClick={() => { setOpen(false); onRetry(retry); }}>
            <Icon name="undo" size={13} />
            <span>{t('Resend from here')}</span>
          </button>
          {destructive && (
            <p className="cc-user-actions-note">
              {t('{n} later exchange(s) and the edits they made will be undone.', { n: String(laterTurns) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function missingPacksSettingsRoute(result: unknown): string | undefined {
  if (!isMissingModelPacksResult(result)) return undefined;
  const route = (result as Record<string, unknown>).settingsRoute;
  return typeof route === 'string' ? route : undefined;
}

export function ChatMessage({ msg, streaming, running = false, retry, onRetry, onEdit, laterTurns, onWidgetSubmit, widgetSubmitted, widgetDocked, onContinue, onOpenSettings, onPlanRun }: ChatMessageProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(msg.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
  };

  if (msg.role === 'user') {
    return (
      <motion.div
        // Entrance: the bubble rises into place and settles. It is keyed by the
        // message id upstream, so each send animates exactly once — a re-render
        // (streaming the reply, scrolling) does not replay it.
        initial={prefersReducedMotion ? false : { opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
        className="cc-user-message"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', margin: '16px 0' }}
      >
        {/* The kit's row is `display:flex` with no justify-content, so inside a
            stretched parent the avatar+text sit hard left and the tail points the
            wrong way. `cc-user-message-row` right-aligns it (see index.css). */}
        <div className="cc-user-message-row" style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
        <Message
          role="user"
          density="compact"
          showTimestamp={false}
          authorName={t('You')}
          // No avatar on outgoing messages: the "You" label already names the
          // speaker, and the circle just ate horizontal room next to the bubble.
          renderAvatar={() => null}
          bubbleSlot={(
            <div style={{
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5,
              // Inherit the bubble's own colour. The kit sets the user bubble to
              // `--kite-primary-foreground` (black on the light accent fill), so
              // hard-coding `theme.text` here painted white text on white.
              fontSize: 13.5, color: 'inherit',
            }}>
              {msg.text}
            </div>
          )}
          theme={chatMessageTheme}
        />
        </div>
        {retry && onRetry && (
          <UserMessageActions
            retry={retry}
            running={running}
            laterTurns={laterTurns ?? 0}
            onRetry={onRetry}
            onEdit={onEdit}
          />
        )}
      </motion.div>
    );
  }

  if (msg.role === 'tool') {
    const tool = msg.tool!;
    const r = tool.result as Record<string, unknown> | undefined;
    const ok = !r || !('error' in r);
    const badgeState: ToolBadgeState = !r ? 'running' : ok ? 'done' : 'error';
    // Summary of key parameters: multiple calls of the tool with the same name (search_templates×7, normalize_loudness×8…)
    // Previously, only the tool name was printed, which looked like repetition; add the distinguishing parameters (query/itemId/category...) for easy identification at a glance.
    const summary = toolArgSummary(tool.args);
    return (
      <div className="cc-tool-row" data-state={badgeState}
        title={typeof tool.args === 'object' ? JSON.stringify(tool.args) : String(tool.args)}>
        <ToolBadge state={badgeState} accent={toolAccent(tool.name)} icon={toolIcon(tool.name)} />
        {/* Tool name + summary + error in a wrappable block: minWidth:0 to allow it to shrink within the flex parent,
overflowWrap:anywhere breaks long tokens - long errors/summaries are wrapped in the panel, no longer cut off when a single line overflows.*/}
        <span className="cc-tool-row-body">
          <span className="cc-tool-row-name">{tool.name}</span>
          {summary && <span className="cc-tool-row-args">{summary}</span>}
          {!ok && <span className="cc-tool-row-error">{String(r!.error)}</span>}
          {!ok && onOpenSettings && isMissingModelPacksResult(r) && (
            <button type="button" onClick={() => onOpenSettings(missingPacksSettingsRoute(r))}
              className="cc-tool-row-action">
              {t('Install in Settings')}
            </button>
          )}
        </span>
      </div>
    );
  }
  if (msg.role === 'error') {
    return (
      <div style={{ color: theme.danger, fontSize: 12.5, margin: '8px 0', overflowWrap: 'anywhere' }}>
        ⚠ {msg.text}
      </div>
    );
  }

  // Quiet system line (which tool calls failed in a run that still completed).
  if (msg.role === 'note') {
    return (
      <div role="note" style={{ margin: '6px 0', fontSize: 12, color: theme.textDim, overflowWrap: 'anywhere' }}>
        {msg.text}
      </div>
    );
  }

  // maxTurns pause card ("continue?"): text = number of rounds executed
  if (msg.role === 'continue') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0', padding: '9px 12px',
        border: `0.5px solid ${theme.border}`, borderRadius: 4, background: theme.panelAlt, fontSize: 12.5, color: theme.textDim,
      }}>
        <span style={{ flex: 1 }}>{t('{n} tool rounds have run back to back — pausing so you can confirm the direction.', { n: msg.text })}</span>
        {onContinue && (
          <button type="button" onClick={onContinue}
            style={{ border: `0.5px solid ${theme.accent}`, background: 'transparent', color: theme.accent, borderRadius: 6, padding: '4px 14px', fontSize: 12.5, cursor: 'pointer', flexShrink: 0 }}>
            {t('Continue')}
          </button>
        )}
      </div>
    );
  }

  // The <widget> form block may be embedded in the assistant text and needs to be separated into paragraphs to render separately.
  // The plain text segment uses lightweight Markdown (**bold** / `code` / list / code block), and no longer spits out ** to the user as it is
  //
  // A <plan> block is split out first: plan mode returns one, and it has to be an
  // actionable card rather than markdown the user cannot run.
  const planParts = onPlanRun ? parsePlans(msg.text) : null;
  const segments: AssistantSegment[] = planParts?.some((part) => part.type === 'plan')
    ? planParts
    : parseWidgets(msg.text);
  if (!segments.length && !msg.thinking?.trim()) return null;
  return (
    <div style={{ margin: '16px 0' }}>
      {!!msg.thinking?.trim() && <ThinkingBlock text={msg.thinking} active={!!streaming} />}
      {segments.map((seg, i) =>
        seg.type === 'plan' ? (
          <PlanCard
            key={i}
            steps={seg.steps}
            title={seg.title}
            note={seg.note}
            running={running}
            onRun={(steps) => onPlanRun?.(steps)}
          />
        ) : seg.type === 'widget' ? (
          widgetDocked && !widgetSubmitted ? (
            <div key={i} className="cc-widget-docked" role="note">
              <Icon name="arrowUp" size={13} />
              <span>{t('Answer below — the questions are docked above the message box.')}</span>
            </div>
          ) : (
            <WidgetCard
              key={i}
              fields={seg.fields}
              title={seg.title}
              submitLabel={seg.submitLabel}
              messagePrefix={seg.messagePrefix}
              persistedSubmitted={widgetSubmitted}
              onSubmit={(answer) => onWidgetSubmit?.(answer)}
            />
          )
        ) : (
          seg.text ? <Markdown key={i} text={seg.text} /> : null
        ),
      )}
      {!streaming && segments.some((segment) => segment.type === 'text' && !!segment.text.trim()) && (
        <div style={{ marginTop: 6, marginLeft: -5 }}>
          <button title={copied ? t('Copied') : t('Copy text')} onClick={copy}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, borderRadius: 6, lineHeight: 0, color: copied ? theme.text : theme.textDim, display: 'grid', placeItems: 'center' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = theme.panelAlt; e.currentTarget.style.color = theme.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = copied ? theme.text : theme.textDim; }}>
            <Icon name="copy" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
