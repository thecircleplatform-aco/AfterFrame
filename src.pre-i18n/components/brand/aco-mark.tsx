import { theme } from '../../theme';

/**
 * The ACO mark for footer attribution: three segments opening outward, which is
 * the same silhouette family as the AfterFrame monogram, drawn as vector so it
 * inherits `currentColor` and needs no asset.
 */
export function AcoMark({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M4 19 11 5l3.4 7" />
      <path d="M20 19h-7.2" />
      <path d="M20 19l-3.4-7" />
    </svg>
  );
}

/** "Powered by ACO" — deliberately small, secondary to the form. */
export function AcoCredit() {
  return (
    <a
      href="https://acocloud.app"
      target="_blank"
      rel="noreferrer noopener"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 10.5, letterSpacing: '0.02em', color: theme.textDim,
        textDecoration: 'none',
      }}
    >
      {`Powered by`}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: theme.text, fontWeight: 600 }}>
        <AcoMark />
        ACO
      </span>
    </a>
  );
}
