import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { theme } from '../../theme';

// Assistant chat markdown via react-markdown + remark-gfm (GFM tables, strikethrough,
// autolinks). react-markdown renders NO raw HTML by default and sanitizes URLs, so it's
// safe for untrusted LLM output. Visual styling lives in index.css under `.cc-md`.

interface MarkdownProps {
  text: string;
  style?: CSSProperties;
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
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">{children}</a>
          ),
          table: ({ children }) => (
            <ScrollableTable>{children}</ScrollableTable>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
