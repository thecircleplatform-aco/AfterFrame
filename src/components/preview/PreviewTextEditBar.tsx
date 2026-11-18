import { useEffect, useRef, useState } from 'react';
import type { TimelineItem } from '../../editor/types';
import { previewTextEditFields } from './previewTextEdit';
import type { PreviewCandidateGeometry } from './previewTransform';

export interface PreviewTextEditBarProps {
  item: TimelineItem;
  selection: PreviewCandidateGeometry;
  composition: { width: number; height: number };
  onPropChange: (id: string, key: string, value: unknown) => void;
  onSeedChat?: (text: string) => void;
  /** Parent requests open the inline text editor (e.g. double-click). */
  autoEdit?: boolean;
  onAutoEditHandled?: () => void;
}

/**
 * The inline text editor for a selected text / text-like MG clip.
 *
 * This used to also draw a floating row of style buttons over the clip. That
 * row covered the frame the user was composing and duplicated controls that now
 * live in the Properties panel, so only the textarea is left — it has to stay
 * anchored to the selection geometry to line up with the text being edited.
 */
export function PreviewTextEditBar({
  item,
  selection,
  composition,
  onPropChange,
  autoEdit,
  onAutoEditHandled,
}: PreviewTextEditBarProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const fields = previewTextEditFields(item);
  const topY = Math.min(...selection.corners.map((point) => point.y));
  const left = `${(selection.center.x / composition.width) * 100}%`;
  const top = `${(topY / composition.height) * 100}%`;

  useEffect(() => {
    if (!autoEdit || !fields?.textKey) return;
    setEditing(true);
    setDraft(fields.text);
    onAutoEditHandled?.();
  }, [autoEdit, fields?.text, fields?.textKey, onAutoEditHandled]);

  useEffect(() => {
    if (!editing) return;
    editorRef.current?.focus();
    editorRef.current?.select();
  }, [editing]);

  if (!fields) return null;

  const saveText = () => {
    if (fields.textKey) onPropChange(item.id, fields.textKey, draft);
    setEditing(false);
  };

  const hasText = fields.textKey !== null;

  // The floating row of buttons (AI / Text / color / size / weight / align) used
  // to sit on top of the selected clip. It covered the very thing the user was
  // framing, and duplicated controls that belong in one place — those now live
  // in the Properties panel. All that remains here is the inline text editor,
  // which has to be attached to the selection geometry to line up with the text.
  if (!editing || !hasText) return null;

  return (
    <div
      className="cc-capedit-bar cc-preview-text-edit-bar is-compact"
      style={{ left, top, transform: 'translate(-50%, calc(-100% - 14px))' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="cc-preview-text-edit-draft" onPointerDown={(event) => event.stopPropagation()}>
        <textarea
          ref={editorRef}
          value={draft}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              saveText();
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              setEditing(false);
            }
          }}
          onBlur={saveText}
        />
      </div>
    </div>
  );
}
