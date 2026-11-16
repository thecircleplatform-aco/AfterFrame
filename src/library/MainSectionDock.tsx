// Screen-level footer dock for the editor's top-level library sections.
//
// Why it lives here and not inside the library panel: the panel is one column of
// the work card, but the sections it switches (Media, Library, Transcript…) are
// workspace-wide. Pinning the control to the bottom edge of the screen gives it a
// fixed, thumb-reachable home, and the strip scrolls sideways instead of wrapping
// so every entry keeps the same compact shape at any width.
import { useRef, useSyncExternalStore, type FocusEvent, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../modules/icons';
import { useT } from '../i18n/locale';
import {
  MAIN_TABS,
  getMainTab,
  selectMainTab,
  subscribeMainTab,
  type MainTab,
} from './LibraryPanel';

const TAB_ICONS: Record<MainTab, IconName> = {
  'Agent': 'sparkles',
  'My Media': 'folder',
  'Sequences': 'film',
  'Library': 'grid',
  'Transcript': 'captions',
  'Subtitles': 'text',
  'Skills': 'wand',
};

export function MainSectionDock() {
  const t = useT();
  const active = useSyncExternalStore(subscribeMainTab, getMainTab, getMainTab);
  const ref = useRef<HTMLElement | null>(null);
  // The strip scrolls sideways with no visible scrollbar, which leaves it
  // unreachable without a trackpad: arrow/Page/Home/End move it, and tabbing to
  // a pill brings that pill into view.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const box = ref.current;
    if (!box) return;
    const page = Math.max(80, box.clientWidth * 0.8);
    const step = (left: number): void => { box.scrollBy({ left, behavior: 'smooth' }); };
    switch (event.key) {
      case 'ArrowRight': step(64); break;
      case 'ArrowLeft': step(-64); break;
      case 'PageDown': step(page); break;
      case 'PageUp': step(-page); break;
      case 'Home': box.scrollTo({ left: 0, behavior: 'smooth' }); break;
      case 'End': box.scrollTo({ left: box.scrollWidth, behavior: 'smooth' }); break;
      default: return;
    }
    event.preventDefault();
  };
  const onFocus = (event: FocusEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement | null;
    if (target?.classList.contains('cc-dock-item')) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  return (
    <nav className="cc-main-dock" aria-label={t('Media library sections')}
      ref={ref} tabIndex={0} onKeyDown={onKeyDown} onFocus={onFocus}>
      {MAIN_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => selectMainTab(tab)}
          className={`cc-dock-item${active === tab ? ' selected' : ''}`}
          aria-current={active === tab ? 'page' : undefined}
          title={t(tab)}
        >
          <span className="cc-dock-icon"><Icon name={TAB_ICONS[tab]} size={17} /></span>
          <span className="cc-dock-label">{t(tab)}</span>
        </button>
      ))}
    </nav>
  );
}
