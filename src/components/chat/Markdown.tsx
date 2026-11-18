import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { theme } from '../../theme';
import { remarkDecorations } from './remarkDecorations';

// Assistant chat markdown via react-markdown + remark-gfm (GFM tables, strikethrough,
// autolinks). react-markdown renders NO raw HTML by default and sanitizes URLs, so it's
// safe for untrusted LLM output. Visual styling lives in index.css under `.cc-md`.
//
// `remarkDecorations` adds highlighting/badges/callouts WITHOUT any rehype plugin:
// it rewrites the mdast into ordinary nodes, so there is still no path for raw
// HTML to reach the DOM. Keep it that way — adding rehype-raw here would require
// a sanitizer, and any schema gap is XSS in the main chat surface.

interface MarkdownProps {
  text: string;
  style?: CSSProperties;
}

/** Icons for the callout tones. Inline SVG so no HTML/emoji font dependency. */
const CALLOUT_ICONS: Record<string, string> = {
  tip: 'M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2zM9 20h6M10 22h4',
  note: 'M12 8h.01M11 12h1v4h1',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 11v6M12 7h.01',
  warning: 'M12 3 2 21h20L12 3zM12 9v5M12 17h.01',
  success: 'M20 6 9 17l-5-5',
  danger: 'M12 3 2 21h20L12 3zM12 9v5M12 17h.01',
};

function Callout({ tone, children }: { tone: string; children?: ReactNode }) {
  const safeTone = CALLOUT_ICONS[tone] ? tone : 'note';
  return (
    <div className={`cc-md-callout-body cc-md-callout-${safeTone}`}>
      <span className="cc-md-callout-icon" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d={CALLOUT_ICONS[safeTone]} />
        </svg>
      </span>
      <div className="cc-md-callout-content">{children}</div>
    </div>
  );
}

/**
 * Wide GFM tables are common (project lists, key/value dumps). Without a hint the
 * chat pane just looks cut off, so this wrapper tracks its own overflow and only
 * shows the fade + "← scroll →" affordance while it can actually scroll. The
 * fade on each side disappears once you hit that end.
 */
function ScrollableTable({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState({ left: false, right: false, overflows: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setState({
      overflows: max > 1,
      left: el.scrollLeft > 1,
      right: el.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    // Column widths settle after fonts load, so re-measure then too.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [measure, children]);

  return (
    <div
      className={
        'cc-md-table-scroll'
        + (state.overflows ? ' is-scrollable' : '')
        + (state.left ? ' can-scroll-left' : '')
        + (state.right ? ' can-scroll-right' : '')
      }
      ref={ref}
      tabIndex={0}
      role="region"
      aria-label="Table, scroll horizontally to see more"
    >
      <table>{children}</table>
    </div>
  );
}

export function Markdown({ text, style }: MarkdownProps) {
  if (!text) return null;
  return (
    <div className="cc-md" style={{ color: theme.text, wordBreak: 'break-word', lineHeight: 1.6, ...style }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDecorations]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">{children}</a>
          ),
          table: ({ children }) => (
            <ScrollableTable>{children}</ScrollableTable>
          ),
          // A decorated callout arrives as a blockquote whose className carries
          // the tone. Anything else keeps the plain blockquote styling.
          blockquote: ({ children, className }) => {
            const match = /cc-md-callout-(\w+)/.exec(className ?? '');
            return match
              ? <div className={`cc-md-callout ${className ?? ''}`}><Callout tone={match[1]!}>{children}</Callout></div>
              : <blockquote>{children}</blockquote>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
