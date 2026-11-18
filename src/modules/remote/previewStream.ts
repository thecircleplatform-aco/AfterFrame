// Live preview streaming to the paired phone.
//
// The phone already mirrors the agent's TEXT over SSE. This adds the picture:
// the desktop's preview canvas is captured a few times a second and sent to the
// phone as JPEG frames over the same broker, so the phone can watch the edit
// while the agent works.
//
// Why frame-push over the existing broker instead of peer-to-peer WebRTC:
//
// - The broker already exists, is tokenised, and survives reconnects. WebRTC
//   would need signalling, ICE, STUN/TURN, and a second security review — and
//   on a LAN with both peers behind the same NAT it buys little.
// - The phone renders a <canvas> anyway. A 6-8 fps JPEG stream is enough to see
//   a cut, a title, or a colour change land, which is the actual use case
//   ("did my edit work?"), not smooth playback.
// - It degrades trivially: no frames = no picture, and the text stream is
//   unaffected. A failed WebRTC handshake is a hard failure mode.
//
// Cost control is deliberate: capture only runs while a phone is actually
// watching, the frame rate and quality are low on purpose, and the encoder
// skips a frame if the previous one has not finished — a slow phone must never
// build a backlog of stale pictures.

/** Typical steady-state frame rate. Enough to see a cut land, cheap to send. */
export const PREVIEW_FPS = 6;
/** JPEG quality. 0.55 is the point where a 640px-wide preview stops looking blocky. */
export const PREVIEW_QUALITY = 0.55;
/** Long edge cap. The phone shows the preview in a ~360px-wide card. */
export const PREVIEW_MAX_WIDTH = 640;
/** Never let more than this many frames queue; drop instead of buffering. */
export const PREVIEW_MAX_INFLIGHT = 2;

export interface PreviewFrame {
  /** Base64 JPEG, no `data:` prefix (matches the agent vision contract). */
  readonly data: string;
  /** The timeline frame this image represents, so the phone can label it. */
  readonly frame: number;
  readonly width: number;
  readonly height: number;
}

/** Downscale factor for a source canvas, never upscaling. */
export function previewScale(width: number, maxWidth = PREVIEW_MAX_WIDTH): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return width > maxWidth ? maxWidth / width : 1;
}

/**
 * Encode a source canvas to a JPEG preview frame.
 *
 * Uses an intermediate canvas at the capped width: encoding the full-resolution
 * preview (often 1920px) then downscaling in CSS wastes both CPU and bandwidth
 * on every frame. Returns null rather than throwing so a tainted canvas or an
 * unsupported encoder simply yields "no preview" instead of breaking the run.
 */
export function capturePreviewFrame(
  source: HTMLCanvasElement,
  frame: number,
): PreviewFrame | null {
  try {
    const scale = previewScale(source.width);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', PREVIEW_QUALITY);
    const comma = dataUrl.indexOf(',');
    if (comma === -1) return null;
    return { data: dataUrl.slice(comma + 1), frame, width, height };
  } catch {
    // A tainted canvas (cross-origin media) throws on toDataURL; the stream
    // degrades to text-only, which is the correct behaviour.
    return null;
  }
}

/**
 * Prefer the live WebGL/2D preview canvas, falling back to the largest canvas
 * on screen. The editor renders the preview into a canvas, but which one is
 * implementation detail — this is deliberately loose so a future renderer does
 * not need a new hook here.
 */
export function findPreviewCanvas(doc: Document = document): HTMLCanvasElement | null {
  const canvases = [...doc.querySelectorAll('canvas')].filter((canvas) => (
    canvas.width > 64 && canvas.height > 64 && canvas.getClientRects().length > 0
  ));
  if (!canvases.length) return null;
  return canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]!;
}
