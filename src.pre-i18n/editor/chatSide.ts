/*
 * Which side of the editor the agent chat panel sits on.
 *
 * The shell is a CSS grid with the chat in column 1, so switching sides is done
 * by flipping the grid's writing direction rather than renumbering every panel.
 * Kept in a tiny external store so the toolbar button and the workspace view
 * stay in sync without threading a prop through the editor controller.
 */
export type ChatSide = 'left' | 'right';

const STORAGE_KEY = 'afterframe.chatSide.ui-v1';
const CHANGE_EVENT = 'cc-chat-side-change';

export function getChatSide(): ChatSide {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'right' ? 'right' : 'left';
  } catch {
    return 'left';
  }
}

export function setChatSide(side: ChatSide): void {
  try {
    localStorage.setItem(STORAGE_KEY, side);
  } catch {
    // Private mode / disabled storage: the layout still flips for this session.
  }
  window.dispatchEvent(new CustomEvent<ChatSide>(CHANGE_EVENT, { detail: side }));
}

export function toggleChatSide(): void {
  setChatSide(getChatSide() === 'left' ? 'right' : 'left');
}

export function subscribeChatSide(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}
