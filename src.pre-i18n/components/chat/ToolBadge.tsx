/*
 * Colored, animated glyph badge for agent tool rows.
 *
 * Replaces the old uniform 7px green dot: each tool gets a glyph that says what
 * it does (brain = thinking, eye = inspecting frames, pencil = editing, …) and
 * a hue from its verb, so a long run of calls is scannable at a glance.
 * State-driven: a rotating ring while the call is in flight, otherwise the
 * glyph sits in a tinted chip; failures turn red.
 */
import type { CSSProperties } from 'react';
import { Icon, type IconName } from '../../modules/icons';
import './tool-badges.css';

/** Fixed hues (not skin tokens) so the families stay distinguishable. */
const HUES = {
  read: '#6aa9ff',
  write: '#ec4899',
  view: '#b98bff',
  search: '#4fd1c5',
  think: '#c08bff',
  danger: 'var(--cc-danger)',
  ok: 'var(--cc-success)',
} as const;

export const THINK_ACCENT = HUES.think;

export type ToolBadgeState = 'running' | 'done' | 'error';

/** Glyph for a tool name. Specialised verbs are tested before the generic ones. */
export function toolIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (/^(search|web|browse|fetch|query|lookup)/.test(n)) return 'search';
  if (/^(view|capture|render|export|probe|frame|snapshot|preview)/.test(n)) return 'eye';
  if (/^(delete|remove|trash|clear)/.test(n)) return 'trash';
  if (/^(read|list|get|inspect|describe|find|count|context)/.test(n)) return 'bookOpen';
  if (/^(edit|update|create|add|insert|apply|set|move|trim|split|replace|rename|import)/.test(n)) return 'pencil';
  if (/^(play|stop|pause)/.test(n)) return 'play';
  return 'sparkles';
}

/** Hue for a tool name, matched on the same verb families as `toolIcon`. */
export function toolAccent(name: string): string {
  const n = name.toLowerCase();
  if (/^(search|web|browse|fetch|query|lookup)/.test(n)) return HUES.search;
  if (/^(view|capture|render|export|probe|frame|snapshot|preview)/.test(n)) return HUES.view;
  if (/^(delete|remove|trash|clear)/.test(n)) return HUES.danger;
  if (/^(read|list|get|inspect|describe|find|count|context)/.test(n)) return HUES.read;
  if (/^(edit|update|create|add|insert|apply|set|move|trim|split|replace|rename|import)/.test(n)) return HUES.write;
  return HUES.ok;
}

export function ToolBadge({ state, accent = HUES.ok, icon, size = 17 }: {
  state: ToolBadgeState;
  accent?: string;
  icon: IconName;
  size?: number;
}) {
  const color = state === 'error' ? HUES.danger : accent;
  const style: CSSProperties = {
    width: size,
    height: size,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
    color,
  };
  return (
    <span className="cc-tool-badge" data-state={state} style={style} aria-hidden>
      <Icon name={state === 'error' ? 'info' : icon} size={Math.round(size * 0.72)} strokeWidth={2.2} />
    </span>
  );
}
