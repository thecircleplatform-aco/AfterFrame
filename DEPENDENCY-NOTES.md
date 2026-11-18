# Dependencies & licensing notes

## Remotion — staying (decided 2026-11-16)

**Decision: keep Remotion 4.0.537. Do not replace it.**

Why the question came up: Remotion is not an OSI license. It is free for
individuals, teams of up to 3, non-profits, and evaluation use; companies with
4+ employees need a paid license.

Why staying is correct for now:

- The threshold is **team size, not user count**. At 2 people, any number of
  users — free and public — still qualifies for the free license.
- Replacing it is not a swap, it is a rewrite. We use it for two jobs that must
  agree with each other:
  1. **Preview** — `@remotion/player` drives frame-accurate React playback in
     `PreviewPanel`, `CaptionsPanel`, `LibraryPanel`, `MgThumb`,
     `InspectorPanel`, `TranscriptPanel`.
  2. **Export** — `@remotion/renderer` + `@remotion/bundler` render the same
     composition to MP4 headlessly.
  The same `src/editor/TimelineComposition.tsx` (433 lines) feeds both, which is
  why exports match the preview. Swapping either half breaks that parity.
- Surface area: 7 of 69 packages, 59 of 1590 source files (~4%).

APIs actually used: `AbsoluteFill`, `useCurrentFrame`, `useVideoConfig`,
`Sequence`, `OffthreadVideo`, `Img`, `delayRender`, `continueRender`,
`getRemotionEnvironment`, `useRemotionEnvironment`, `cancelRender`,
`interpolateColors`, `Internals`.

### Revisit only when

- The team exceeds 3 people → buy the Company License (~$25/mo/seat, or
  $0.01/render with a $100/mo minimum). Cheaper than any rewrite.
- The license terms change materially. **Re-read remotion.dev/license at that
  point** rather than trusting this note — it reflects terms as understood on
  2026-11-16, not a legal opinion.

### Alternatives considered and rejected

| Candidate | License | Why rejected |
|---|---|---|
| Revideo | Apache-2.0 | Closest fit, but no `OffthreadVideo` equivalent, no `delayRender` font gating, no preview/export parity. Would mean rewriting the composition and ~59 call sites. |
| Canvas + WebCodecs | none | No license risk at all, but requires rebuilding preview, export, and parity from scratch. Months of work. |
| Motion Canvas | MIT | Animation DSL with no video export pipeline. Does not fit a timeline editor. |

## ffmpeg-static

Ships a GPL-2.0-or-later binary. This is a **distribution** obligation: when
publishing builds, ship a written offer for the corresponding FFmpeg source, or
switch to an LGPL-2.1 build. Not an issue for private or internal use.

## Canon LUTs (`assets/luts/*.cube`)

Marked "All Rights Reserved" upstream. Remove or replace before any public
distribution. Fine for private use.

## Fonts

All bundled faces are OFL-1.1; notices live in `public/fonts/LICENSES.md`.
