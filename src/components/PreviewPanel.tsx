import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { Player, Thumbnail, type CallbackListener, type PlayerRef } from '@remotion/player';
import { theme, themeAlpha } from '../theme';
import { TimelineComposition } from '../editor/TimelineComposition';
import type { SelectedPreviewStatus, SelectedPreviewStatusListener } from '../gl/previewAdapter';
import {
  captionTrackEntries,
  type ProjectDoc,
  type ClipTransform,
  type KeyframeProp,
  type TimelineItem,
  type TimelineState,
  type TrackId,
} from '../editor/types';
import { useSelectionRefMode } from '../agent/selection-refs';
import { RegionPickOverlay } from './preview/RegionPickOverlay';
import { CaptionPreviewEditor } from '../captions/CaptionPreviewEditor';
import type { CaptionSelectionRef } from '../captions/captionSelection';
import type { CaptionsData } from '../captions/types';
import {
  onCaptionStylePointerDrop,
  type CaptionStyleDragPayload,
} from '../captions/captionStyleDrag';
import { appendDroppedManualCaption } from '../captions/manualCaptions';
import { Icon } from '../modules/icons';
import { useT } from '../i18n/locale';
import { usePreviewProjectDoc } from '../media/previewMedia';
import {
  getPreviewSourceMode,
  setPreviewSourceMode,
  subscribeQualityMode,
  type PreviewSourceMode,
} from '../media/qualityPolicy';
import type { SlipPreview } from '../editor/slip';
import { SlipTwoUpPreview } from './SlipTwoUpPreview';
import { PREVIEW_SHARED_AUDIO_TAGS } from './previewAudioPool';
import { SafeZoneOverlay } from './SafeZoneOverlay';
import { PreviewTransformOverlay } from './preview/PreviewTransformOverlay';
import { PreviewPopover, PreviewPopoverRow } from './preview/PreviewPopover';
import {
  bumpPreviewFontSize,
  cyclePreviewAlign,
  previewTextEditFields,
} from './preview/previewTextEdit';
import { fitPreviewCanvasSize, previewPaddedClientSize, previewStageContentSize, type PreviewCanvasSize } from './preview/previewCanvasGeometry';

const MEDIA_LOADING_NOTICE_DELAY_MS = 160;

const PREVIEW_SOURCE_CYCLE: readonly PreviewSourceMode[] = ['auto', 'original', 'proxy'];

function previewStatusKey(status: Pick<SelectedPreviewStatus, 'kind' | 'targetId'>): string {
  return `${status.kind}\u0000${status.targetId}`;
}

interface PreviewPanelProps {
  state: TimelineState;
  project: ProjectDoc;
  playerRef: RefObject<PlayerRef | null>;
  onImport: (file: File) => Promise<void>;
  offlineSrcs?: ReadonlySet<string>;
  /** Direct editing of canvas captions (check box + floating toolbar). If it has not been transmitted (such as proposal preview status), it is read-only. */
  onUpdateCaptions?: (patch: Partial<CaptionsData>, track?: TrackId) => void;
  onSelectCaption?: (selection: CaptionSelectionRef | null) => void;
  activeCaptionSelection?: CaptionSelectionRef | null;
  onSeedChat?: (text: string) => void;
  onSelectItem?: (id: string | null) => void;
  onSetItemTransform?: (id: string, patch: ClipTransform) => void;
  onSetItemKeyframe?: (id: string, prop: KeyframeProp, localFrame: number, value: number) => void;
  onBeginHistoryGesture?: () => void;
  onEndHistoryGesture?: () => void;
  onItemPropChange?: (id: string, key: string, value: unknown) => void;
  timelineId: string;
  selectedItem: TimelineItem | null;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  selectedPreviewStatuses?: readonly SelectedPreviewStatus[];
  onSelectedPreviewStatus?: SelectedPreviewStatusListener;
  slipPreview?: SlipPreview | null;
  hoverPreviewFrame?: number | null;
}

export const PreviewPanel = memo(function PreviewPanel({
  state, project, playerRef, onImport, offlineSrcs, onUpdateCaptions, onSelectCaption, activeCaptionSelection, onSeedChat,
  onSelectItem, onSetItemTransform, onSetItemKeyframe, onBeginHistoryGesture, onEndHistoryGesture,
  onItemPropChange,
  timelineId, selectedItem, inspectorOpen, onToggleInspector,
  selectedPreviewStatuses, onSelectedPreviewStatus, slipPreview,
  hoverPreviewFrame = null,
}: PreviewPanelProps) {
  const t = useT();
  const renderProject = useMemo<ProjectDoc>(() => ({
    ...project,
    timelines: project.timelines.map((timeline) => timeline.id === timelineId
      ? { ...timeline, ...state, id: timeline.id, name: timeline.name, order: timeline.order }
      : timeline),
  }), [project, state, timelineId]);
  const preview = usePreviewProjectDoc(renderProject, timelineId);
  const duration = preview.plan.durationInFrames;
  const playerInputProps = useMemo(() => ({
    state: preview.state,
    project: preview.project,
    timelineId,
    selectedItemId: selectedItem?.id,
    onSelectedPreviewStatus,
  }), [preview.state, preview.project, timelineId, selectedItem?.id, onSelectedPreviewStatus]);
  const thumbnailInputProps = useMemo(() => ({
    state: preview.state,
    project: preview.project,
    timelineId,
  }), [preview.state, preview.project, timelineId]);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<PreviewCanvasSize>({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [showSafe, setShowSafe] = useState(false);
  // The preview toolbar's three panels. Kept mutually exclusive: opening one
  // closes the others so they never stack over each other on the picture.
  const [qualityOpen, setQualityOpen] = useState(false);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const qualityBtnRef = useRef<HTMLButtonElement>(null);
  const guidesBtnRef = useRef<HTMLButtonElement>(null);
  const propertiesBtnRef = useRef<HTMLButtonElement>(null);
  const previewSourceMode = useSyncExternalStore(subscribeQualityMode, getPreviewSourceMode, getPreviewSourceMode);
  const qualityLabel = previewSourceMode === 'original' ? t('High') : previewSourceMode === 'proxy' ? t('Smooth') : t('Auto');
  // Text edits need a one-shot "start editing" signal to the overlay: the bar
  // that used to sit on the clip is gone, so the panel asks it to open instead.
  const [textEditRequest, setTextEditRequest] = useState(0);
  const textFields = useMemo(() => (selectedItem ? previewTextEditFields(selectedItem) : null), [selectedItem]);

  /** Opens the inline text editor, which lives in the transform overlay. */
  const onRequestTextEdit = () => setTextEditRequest((n) => n + 1);
  const onBumpFontSize = (direction: 1 | -1) => {
    if (!selectedItem || !textFields?.fontSizeKey) return;
    onItemPropChange?.(selectedItem.id, textFields.fontSizeKey, bumpPreviewFontSize(textFields, direction));
  };
  const onCycleAlign = () => {
    if (!selectedItem || !textFields?.alignKey) return;
    onItemPropChange?.(selectedItem.id, textFields.alignKey, cyclePreviewAlign(textFields.align));
  };
  const [autoEditCaption, setAutoEditCaption] = useState<{ trackId: TrackId; laneId: string } | null>(null);
  // Expose Player during full screen preview (` shortcut key/timeline toolbar button to make Player full screen)
  // Comes with a control bar; the editing state still uses the timeline transport, and does not display dual sets of controls.
  // Must listen to Remotion's own fullscreenchange: it walks the webkit legacy API in Chrome,
  // The document standard event is not guaranteed to be triggered, the SDK emitter is the real source.
  const [fullscreen, setFullscreen] = useState(false);
  const transformApi = onSelectItem && onSetItemTransform && onSetItemKeyframe
    && onBeginHistoryGesture && onEndHistoryGesture
    ? {
      onSelectItem,
      onSetItemTransform,
      onSetItemKeyframe,
      onBeginHistoryGesture,
      onEndHistoryGesture,
      onItemPropChange,
      onSeedChat,
    }
    : null;
  const hasItems = state.items.length > 0;
  const previewCanvasSize = fitPreviewCanvasSize(stageSize, {
    width: state.width,
    height: state.height,
  });
  const failedProxies = preview.proxies.filter(({ proxy }) => proxy.status === 'failed');
  const pendingProxies = preview.proxies.filter(({ proxy }) => proxy.status === 'loading').length;
  const shaderFallbacks = useMemo(
    () => (selectedPreviewStatuses ?? []).filter((status) => status.phase === 'fallback'),
    [selectedPreviewStatuses],
  );
  const durableShaderFallback = shaderFallbacks.find((status) => status.fallbackReason !== 'media-loading');
  const mediaLoadingFallbacks = useMemo(
    () => shaderFallbacks.filter((status) => status.fallbackReason === 'media-loading'),
    [shaderFallbacks],
  );
  const mediaLoadingKeys = useMemo(
    () => mediaLoadingFallbacks.map(previewStatusKey).sort(),
    [mediaLoadingFallbacks],
  );
  const mediaLoadingStartedAtRef = useRef(new Map<string, number>());
  const [visibleMediaLoading, setVisibleMediaLoading] = useState<{ key: string; startedAt: number } | null>(null);
  useEffect(() => {
    const startedAt = mediaLoadingStartedAtRef.current;
    const activeKeys = new Set(mediaLoadingKeys);
    for (const key of startedAt.keys()) {
      if (!activeKeys.has(key)) startedAt.delete(key);
    }
    const now = Date.now();
    for (const key of mediaLoadingKeys) {
      if (!startedAt.has(key)) startedAt.set(key, now);
    }
    let nextKey: string | undefined;
    let nextVisibleAt = Number.POSITIVE_INFINITY;
    for (const key of mediaLoadingKeys) {
      const visibleAt = startedAt.get(key)! + MEDIA_LOADING_NOTICE_DELAY_MS;
      if (visibleAt < nextVisibleAt) {
        nextKey = key;
        nextVisibleAt = visibleAt;
      }
    }
    if (!nextKey) return undefined;
    const nextStartedAt = startedAt.get(nextKey)!;
    const timeout = window.setTimeout(
      () => setVisibleMediaLoading({ key: nextKey, startedAt: nextStartedAt }),
      Math.max(0, nextVisibleAt - now),
    );
    return () => window.clearTimeout(timeout);
  }, [mediaLoadingKeys]);
  const visibleMediaLoadingFallback = mediaLoadingFallbacks.find((status) => {
    const key = previewStatusKey(status);
    if (!visibleMediaLoading || key !== visibleMediaLoading.key) return false;
    return mediaLoadingStartedAtRef.current.get(key) === visibleMediaLoading.startedAt;
  });
  const visibleShaderFallback = durableShaderFallback ?? visibleMediaLoadingFallback;
  const offlineNames = [...new Set(renderProject.timelines
    .filter((timeline) => preview.plan.timelineIds.includes(timeline.id))
    .flatMap((timeline) => timeline.items)
    .filter((item) => !!item.src && offlineSrcs?.has(item.src))
    .map((item) => item.name))];
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onChange: CallbackListener<'fullscreenchange'> = (e) => setFullscreen(e.detail.isFullscreen);
    player.addEventListener('fullscreenchange', onChange);
    return () => player.removeEventListener('fullscreenchange', onChange);
  }, [playerRef, hasItems]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    const apply = (next: PreviewCanvasSize) => {
      setStageSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) apply(previewStageContentSize(entry));
    });
    observer.observe(stage);
    const style = getComputedStyle(stage);
    apply(previewPaddedClientSize(
      { width: stage.clientWidth, height: stage.clientHeight },
      {
        left: Number.parseFloat(style.paddingLeft) || 0,
        right: Number.parseFloat(style.paddingRight) || 0,
        top: Number.parseFloat(style.paddingTop) || 0,
        bottom: Number.parseFloat(style.paddingBottom) || 0,
      },
    ));
    return () => observer.disconnect();
  }, []);
  // Selection mode (canvas-region-marked): drag a marquee → region reference
  const pickMode = useSelectionRefMode();
  const importFiles = async (files: FileList | File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    try { for (const file of Array.from(files)) await onImport(file); }
    finally { setBusy(false); }
  };
  const dropCaptionStyle = (payload: CaptionStyleDragPayload | null, clientX: number, clientY: number): boolean => {
    const box = videoBoxRef.current;
    const entry = captionTrackEntries(state).find(({ id }) => id === payload?.trackId);
    if (!payload || !box || !entry?.captions || !onUpdateCaptions) return false;
    const rect = box.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    const startMs = ((playerRef.current?.getCurrentFrame() ?? 0) / state.fps) * 1000;
    const dropped = appendDroppedManualCaption(entry.captions, state.items, payload.template, t('Double-click to edit the caption'), startMs, {
      anchor: 'middle-center', offsetXRatio: x - 0.5, offsetYRatio: y - 0.5,
    });
    if (!dropped) return false;
    playerRef.current?.pause();
    onUpdateCaptions(dropped.patch, payload.trackId);
    setAutoEditCaption({ trackId: payload.trackId, laneId: dropped.laneId });
    return true;
  };
  useEffect(() => onCaptionStylePointerDrop(({ payload, clientX, clientY }) => {
    dropCaptionStyle(payload, clientX, clientY);
  }));
  return (
    <section style={{ display: 'flex', flex: 1, flexDirection: 'column', background: theme.panel, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      {/* No header bar: it cost 30px of vertical space for two rarely-touched
          switches. They float over the stage instead, fading out with the rest
          of the chrome and coming back on hover/focus. */}
      <div ref={stageRef} className="cc-preview-stage"
        // Suppress the browser's native <video> context menu (download / picture-in-picture
        // / loop) because the preview is a canvas, not an exposed HTML5 video element.
        onContextMenu={(event) => event.preventDefault()}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
        onDrop={(event) => { event.preventDefault(); void importFiles(event.dataTransfer.files); }}>
        {state.items.length === 0 ? (
          <>
            <input ref={inputRef} type="file" accept="video/*,image/*,audio/*" multiple hidden onChange={(event) => { if (event.target.files) void importFiles(event.target.files); event.target.value = ''; }} />
            <button className="cc-preview-empty" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Icon name="upload" size={24} />
              <span>{busy ? t('Importing media…') : t('Drop media here')}</span>
            </button>
          </>
        ) : (
          // Wrapper carries the sizing so the safe-zone overlay lines up exactly
          // on the video rect (Player fills the wrapper).
          <div ref={videoBoxRef} className="cc-preview-canvas" style={{
            position: 'relative',
            width: previewCanvasSize.width || (state.width >= state.height ? '100%' : 'auto'),
            height: previewCanvasSize.height || (state.width >= state.height ? 'auto' : '100%'),
            aspectRatio: `${state.width} / ${state.height}`,
          }} onErrorCapture={(event) => {
            if (!(event.target instanceof HTMLVideoElement)) return;
            const failedUrl = event.target.currentSrc || event.target.src;
            const source = preview.proxies.find(({ src, proxy }) => {
              const urls = [src, proxy.status === 'ready' ? proxy.previewSrc : ''].filter(Boolean);
              return urls.some((url) => new URL(url, window.location.href).href === failedUrl);
            });
            if (source) preview.requestFallback(source.src);
          }}>
            <Player
              ref={playerRef}
              component={TimelineComposition}
              inputProps={playerInputProps}
              durationInFrames={duration}
              fps={state.fps}
              compositionWidth={state.width}
              compositionHeight={state.height}
              numberOfSharedAudioTags={PREVIEW_SHARED_AUDIO_TAGS}
              // Full screen black: WebKit legacy full screen div does not automatically blacken the background, and the page checkerboard will be revealed on both sides.
              style={{ width: '100%', height: '100%', backgroundColor: fullscreen ? '#000' : undefined }}
              controls={fullscreen}
              // Playback runs only through the timeline transport
              // (play/pause button + Space shortcut), not the player itself. clickToPlay
              // off = clicking the frame doesn't toggle; spaceKeyToPlayOrPause off = the app
              // shortcut is the single Space handler (the Player's own handler would
              // double-toggle it to a no-op).
              clickToPlay={fullscreen}
              spaceKeyToPlayOrPause={false}
              acknowledgeRemotionLicense
              // No loop: playback stops at the final frame (editor convention).
              // Restart by pressing play again.
            />
            {!fullscreen && hoverPreviewFrame !== null && (
              <div className="cc-preview-hover-frame" aria-label={t('Timeline hover preview')}>
                <Thumbnail
                  component={TimelineComposition}
                  inputProps={thumbnailInputProps}
                  frameToDisplay={hoverPreviewFrame}
                  durationInFrames={duration}
                  fps={state.fps}
                  compositionWidth={state.width}
                  compositionHeight={state.height}
                  style={{ display: 'block', width: '100%', aspectRatio: `${state.width} / ${state.height}` }}
                />
              </div>
            )}
            {slipPreview && <SlipTwoUpPreview preview={slipPreview} />}
            {offlineNames.length > 0 && (
              <div role="status" style={{
                position: 'absolute', top: 8, left: 8, right: 8, zIndex: 12,
                padding: '6px 10px', borderRadius: 6, background: themeAlpha.shadow(0.88),
                border: `1px solid ${theme.accent}`, color: theme.text, fontSize: 11,
              }}>
                {t('Offline media: {list}', { list: offlineNames.join('\u3001') })}
              </div>
            )}
            {(pendingProxies > 0 || failedProxies.length > 0) && (
              <div role="status" style={{
                position: 'absolute', bottom: 8, left: 8, zIndex: 12,
                maxWidth: 'calc(100% - 16px)', padding: '5px 8px', borderRadius: 5,
                background: themeAlpha.shadow(0.84), color: failedProxies.length ? theme.accent : theme.textMuted,
                fontSize: 10,
              }}>
                {failedProxies.length
                  ? t('Smooth preview is unavailable, so playback is at full quality (the picture is fine and export is unaffected)')
                  : t('Preparing smooth preview…')}
              </div>
            )}
            {visibleShaderFallback && (
              <div role="status" aria-live="polite" style={{
                position: 'absolute', bottom: 8, right: 8, zIndex: 12,
                maxWidth: 'calc(100% - 16px)', padding: '5px 8px', borderRadius: 4,
                border: `0.5px solid ${theme.accent}`, background: themeAlpha.shadow(0.88),
                color: theme.text, fontSize: 10,
              }}>
                {visibleShaderFallback.fallbackReason === 'media-loading'
                  ? t('Loading the effect preview; showing a fallback frame meanwhile')
                  : visibleShaderFallback.adapter === 'css-transition'
                    ? t('Shader preview fell back to a CSS approximation; what you see is not the exported result')
                    : t('Shader preview unavailable; showing the unprocessed source')}
              </div>
            )}
            {showSafe && <SafeZoneOverlay />}
            {pickMode && <RegionPickOverlay state={state} playerRef={playerRef} />}
            {!pickMode && !fullscreen && transformApi && (
              <PreviewTransformOverlay state={state} playerRef={playerRef} {...transformApi}
                textEditRequest={textEditRequest} />
            )}
            {!pickMode && !fullscreen && onUpdateCaptions && captionTrackEntries(state).map(({ id, captions }) => captions?.enabled ? (
              <CaptionPreviewEditor
                key={id}
                trackId={id}
                state={state}
                captions={captions}
                playerRef={playerRef}
                onUpdateCaptions={(patch) => onUpdateCaptions(patch, id)}
                onSelectCaption={onSelectCaption}
                activeSelection={activeCaptionSelection}
                onSeedChat={onSeedChat}
                autoEditLaneId={autoEditCaption?.trackId === id ? autoEditCaption.laneId : undefined}
                onAutoEditHandled={() => setAutoEditCaption(null)}
              />
            ) : null)}
          </div>
        )}
        {/* Top bar. Everything the preview can do lives here in one row, so the
            picture is never covered by controls that follow a selection. Panels
            that need more than an on/off state open below their own button. */}
        {(state.items.length > 0 || pickMode) && (
          <div className="cc-preview-bar">
            {pickMode && (
              <span className="cc-preview-bar-badge">
                <Icon name="cursor" size={10} />
                {t('Drag a box on the canvas to reference it')}
              </span>
            )}
            {state.items.length > 0 && (
              <button type="button" ref={qualityBtnRef}
                className={`cc-preview-bar-btn${qualityOpen ? ' is-on' : ''}`}
                onClick={() => { setQualityOpen((v) => !v); setGuidesOpen(false); }}
                aria-expanded={qualityOpen}
                title={t('Preview quality')}>
                <Icon name="film" size={11} />
                {t('Preview quality')}: {qualityLabel}
              </button>
            )}
            {state.items.length > 0 && (
              <button type="button" ref={guidesBtnRef}
                className={`cc-preview-bar-btn${showSafe ? ' is-on' : ''}`}
                onClick={() => { setGuidesOpen((v) => !v); setQualityOpen(false); }}
                aria-expanded={guidesOpen} aria-pressed={showSafe}
                title={t('Composition guides')}>
                <Icon name="grid" size={11} />
                {t('Guides')}
              </button>
            )}
            {selectedItem && !inspectorOpen && (
              <button type="button" ref={propertiesBtnRef}
                className="cc-preview-bar-btn"
                onClick={onToggleInspector}
                title={t('Show properties')}>
                <Icon name="sliders" size={11} />
                {t('Properties')}
              </button>
            )}
            {selectedItem && inspectorOpen && (
              // The inspector occupies the right side of the preview, so its
              // toggle collapses to an icon rather than a labelled pill that
              // would sit underneath the panel it opened.
              <button type="button" ref={propertiesBtnRef}
                className="cc-preview-bar-btn is-on is-icon"
                onClick={onToggleInspector} aria-pressed
                title={t('Hide properties')} aria-label={t('Hide properties')}>
                <Icon name="sliders" size={11} />
              </button>
            )}
          </div>
        )}

        <PreviewPopover open={qualityOpen} anchor={qualityBtnRef.current} width={224}
          title={t('Preview quality')} onClose={() => setQualityOpen(false)}>
          {PREVIEW_SOURCE_CYCLE.map((mode) => (
            <button key={mode} type="button"
              className={`cc-preview-pop-option${previewSourceMode === mode ? ' is-on' : ''}`}
              onClick={() => { setPreviewSourceMode(mode); setQualityOpen(false); }}>
              <span className="cc-preview-pop-option-name">
                {mode === 'auto' ? t('Auto') : mode === 'original' ? t('High') : t('Smooth')}
              </span>
              <span className="cc-preview-pop-option-hint">
                {mode === 'auto'
                  ? t('Follows your quality policy')
                  : mode === 'original'
                    ? t('Original media — best quality, heavier')
                    : t('Lightweight copy — smoother playback')}
              </span>
            </button>
          ))}
        </PreviewPopover>

        <PreviewPopover open={guidesOpen} anchor={guidesBtnRef.current} width={224}
          title={t('Composition guides')} onClose={() => setGuidesOpen(false)}>
          <PreviewPopoverRow label={t('Safe zones')}
            hint={t('Title and action safe for vertical output')}>
            <button type="button" role="switch" aria-checked={showSafe}
              className={`cc-preview-switch${showSafe ? ' is-on' : ''}`}
              onClick={() => setShowSafe((v) => !v)} aria-label={t('Safe zones')}>
              <span className="cc-preview-switch-knob" />
            </button>
          </PreviewPopoverRow>
        </PreviewPopover>

        <PreviewPopover open={textOpen} anchor={propertiesBtnRef.current} width={252}
          title={t('Selected clip')} onClose={() => setTextOpen(false)}>
          {textFields ? (
            <>
              {onSeedChat && textFields.textKey && (
                <button type="button" className="cc-preview-pop-action is-ai"
                  onClick={() => {
                    setTextOpen(false);
                    onSeedChat(t('Improve this on-screen text (keep layout): "{text}"', {
                      text: textFields.text || t('(empty)'),
                    }));
                  }}>
                  <Icon name="sparkles" size={12} />
                  {t('Ask AI to rewrite this text')}
                </button>
              )}
              <PreviewPopoverRow label={t('Text')}>
                <button type="button" className="cc-preview-pop-action is-compact"
                  onClick={() => { setTextOpen(false); onRequestTextEdit?.(); }}>
                  <Icon name="pencil" size={11} />
                  {t('Edit')}
                </button>
              </PreviewPopoverRow>
              {textFields.colorKey && (
                <PreviewPopoverRow label={t('Color')}>
                  <span className="cc-preview-pop-swatch" style={{ background: textFields.color }} />
                </PreviewPopoverRow>
              )}
              {textFields.fontSizeKey && (
                <PreviewPopoverRow label={t('Size')}>
                  <div className="cc-preview-pop-stepper">
                    <button type="button" aria-label={t('Smaller text')}
                      onClick={() => onBumpFontSize?.(-1)}>A−</button>
                    <button type="button" aria-label={t('Bigger text')}
                      onClick={() => onBumpFontSize?.(1)}>A+</button>
                  </div>
                </PreviewPopoverRow>
              )}
              {textFields.alignKey && (
                <PreviewPopoverRow label={t('Align')}>
                  <button type="button" className="cc-preview-pop-action is-compact"
                    onClick={() => onCycleAlign?.()}>
                    {textFields.align === 'left' ? '⫷' : textFields.align === 'right' ? '⫸' : '☰'}
                  </button>
                </PreviewPopoverRow>
              )}
            </>
          ) : (
            <p className="cc-preview-pop-empty">{t('Select a text clip to edit it here.')}</p>
          )}
        </PreviewPopover>
      </div>
    </section>
  );
});
