import { Icon } from '../modules/icons';
import { useT } from '../i18n/locale';

interface AddSolidCanvasCardProps {
  label: string;
  onAdd: () => void;
}

/**
 * Shortcut tile that drops a solid colour on the timeline.
 *
 * The full phrase ("Add solid background/canvas") is 27 characters and cannot
 * fit a ~109px grid column without hyphenating mid-word, which looked broken.
 * The visible label is therefore the existing short "Add solid color" string,
 * while the full phrase stays on `aria-label`/`title` so screen readers and hover
 * still get the precise meaning.
 */
export function AddSolidCanvasCard({ label, onAdd }: AddSolidCanvasCardProps) {
  const t = useT();
  return (
    <button
      type="button"
      className="cc-add-solid-canvas-card"
      aria-label={label}
      title={label}
      onClick={onAdd}
    >
      <span className="cc-media-entry-thumb cc-add-solid-canvas-thumb">
        <Icon name="image" size={20} strokeWidth={1.4} />
      </span>
      <span className="cc-media-entry-name" aria-hidden="true">{t('Add solid color')}</span>
    </button>
  );
}
