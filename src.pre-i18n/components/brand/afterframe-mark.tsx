/**
 * The AfterFrame monogram, ported from FreeCut
 * (`freecut/src/components/brand/afterframe-mark.tsx`).
 *
 * The artwork is the shipped asset (`/brand/af-mark-black.png`, cut from the
 * master icon), used as a CSS mask so the mark takes `currentColor`: black on a
 * light surface, white on a dark one, from one file. No re-drawing, no
 * re-thresholding — the letterforms are the source art, pixel for pixel.
 */
export function AfterFrameMark({ size = 22, backgroundImage }: {
  /** Cap height in pixels; the width follows the artwork's 396×302 ratio. */
  size?: number;
  /** Paints the glyphs with a gradient instead of `currentColor` (hover glow). */
  backgroundImage?: string;
}) {
  const width = Math.round((size * 396) / 302);
  return (
    <span
      role="img"
      aria-label="AF"
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width,
        height: size,
        background: 'currentColor',
        ...(backgroundImage ? { backgroundImage } : null),
        WebkitMaskImage: 'url(/brand/af-mark-black.png)',
        maskImage: 'url(/brand/af-mark-black.png)',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}
