import { Suspense, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ProjectMeta } from '../../persist/projectStoreCoordinators';
import { theme } from '../../theme';
import { useT } from '../../i18n/locale';
import { Icon } from '../../modules/icons';
import { AfterFrameLogo } from '../brand/afterframe-logo';
import { bindAction } from '../../shortcuts/actionRegistry';
// Opened on demand, so they load on demand — see dashboardDialogs.tsx.
import {
  McpGuideDialog, MediaCleanupDialog, SettingsDialog, ShortcutsDialog, WorkflowDialog,
} from './dashboardDialogs';
import { useDashboardDialogPrefetch } from './dashboardDialogLoaders';
import { SkinPicker } from '../settings/SkinPicker';
import { LanguageWidget } from '../LanguageWidget';
import {
  actionRow, actionRowVisible, bottomGlow, bottomNav, card, cardBody, cardHover, cardMeta, cardName,
  circleButton, container,
  emptyState, grid, headerRow, iconButton,
  greetingHint, greetingText, LAUNCH_TINTS, launchBody, launchGreeting, launchGrid, launchIcon, launchLabel,
  launchPanel, launchSub, launchTile, launchTop, newProjectButton, newProjectButtonCompact, newProjectButtonHover,
  metaText, miniBtn, modelSetupBar, modelSetupButton,
  menuHead, menuPanel, menuRow, menuRowButton, menuRowLabel, menuScrim,
  bellBadge, notificationCard, notificationClose, notificationEmpty, notificationPanel, notificationRow, notificationStack,
  modelSetupIcon, nameInput, navCapsule, navLabel, navSoonDot, navTab, bottomNavWrap,
  menuFooter, profileActions, profileAvatar, profileButton, profileButtonPrimary,
  profileEmail, profileIdentity, profileName, profileRow, profileSignOut,
  searchCapsule, searchBox, searchClear, searchIcon, searchInput, modernSearchInput,
  projectSectionCount, projectSectionHead, projectSectionTitle,
  shell, thumb, thumbImage, thumbScrim, thumbScrimVisible,
  workflowButton, workflowButtonBody, workflowButtonChevron, workflowButtonHint, workflowButtonIcon, workflowButtonLabel,
} from './dashboardStyles';
import { relativeProjectTime, NOTICE_CLEARANCE, type DashboardModel, type DashboardProps } from './useDashboardModel';
import { AnimatedIcon } from './AnimatedIcon';
import { showAppToast } from '../../ui/appToast';
import { AppToastHost } from '../../ui/AppToastHost';
import { signOut, useAuthSession, userInitials } from '../../auth/session';
import { AuthDialog } from '../auth/AuthDialog';
import type { NewProjectPreset } from '../../app/newProjectPreset';

function ModelSetupCard({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return (
    <section role="status" style={modelSetupBar}>
      <span style={modelSetupIcon}><Icon name="sparkles" size={18} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block', color: theme.textStrong, fontSize: 13.5 }}>{t('Configure a model to start using the Agent')}</strong>
        <span style={{ display: 'block', marginTop: 3, color: theme.textDim, fontSize: 11.5, lineHeight: 1.5 }}>
          {t('Configure any cloud or local model to use conversational editing in the editor.')}
        </span>
      </span>
      <button type="button" onClick={onOpen} style={modelSetupButton}>{t('Configure Model')}</button>
    </section>
  );
}

/** Secondary header actions, folded into one quiet overflow to keep the header clean. */
function SideMenu({ model, onClose }: { model: DashboardModel; onClose: () => void }) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const auth = useAuthSession();
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <motion.div
        key="scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        style={menuScrim}
        onMouseDown={onClose}
      />
      <motion.aside
        key="panel"
        role="dialog"
        aria-label={t('Main navigation')}
        className="cc-drawer-rail"
        style={menuPanel}
        onMouseDown={(e) => e.stopPropagation()}
        initial={reduceMotion ? false : { x: -28, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { x: -28, opacity: 0 }}
        transition={reduceMotion
          ? { duration: 0.12 }
          : { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
      >
        <div style={menuHead}>
          <AfterFrameLogo size="md" glow />
          <button type="button" onClick={onClose} aria-label={t('Close')} style={iconButton}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div style={menuRow}>
          <span style={menuRowLabel}>{t('Appearance')}</span>
          <SkinPicker />
        </div>
        <div style={menuRow}>
          <span style={menuRowLabel}>{t('Language')}</span>
          <LanguageWidget placement="up" />
        </div>
        <button type="button" style={menuRowButton}
          onClick={() => { onClose(); model.setDialog('settings', true); }}>
          <Icon name="sliders" size={15} /> {t('Settings · API Keys')}
        </button>
        <button type="button" style={menuRowButton}
          onClick={() => { onClose(); model.setDialog('shortcuts', true); }}>
          <Icon name="keyboard" size={15} /> {t('Edit keyboard shortcuts')}
        </button>
        <button type="button" style={menuRowButton}
          onClick={() => { onClose(); model.setDialog('mcp', true); }}>
          <Icon name="plug" size={15} /> {t('External agents (MCP)')}
        </button>
        <button type="button" style={menuRowButton}
          onClick={() => { onClose(); model.setDialog('cleanup', true); }}>
          <Icon name="trash" size={15} /> {t('Clean up media')}
        </button>
        <div style={menuFooter}>
          {auth.status === 'loading' ? (
            // Don't flash "Not signed in" while `/auth/me` is still in flight.
            <div style={profileRow} aria-busy="true">
              <span aria-hidden="true" style={{ ...profileAvatar, color: theme.textDim }}>
                <Icon name="user" size={16} />
              </span>
              <span style={profileIdentity}>
                <span style={profileName}>{t('Account')}</span>
                <span style={profileEmail}>{t('Checking your session…')}</span>
              </span>
            </div>
          ) : auth.status === 'signedIn' ? (
            <div style={profileRow}>
              <span aria-hidden="true" style={profileAvatar}>{userInitials(auth.user)}</span>
              <span style={profileIdentity}>
                <span style={profileName}>{auth.user.name?.trim() || auth.user.email.split('@')[0]}</span>
                <span style={profileEmail} title={auth.user.email}>{auth.user.email}</span>
              </span>
              <button
                type="button"
                onClick={() => { void signOut(); }}
                aria-label={t('Sign out')}
                title={t('Sign out')}
                style={profileSignOut}
              >
                <Icon name="logout" size={15} />
              </button>
            </div>
          ) : (
            <>
              <div style={profileRow}>
                <span aria-hidden="true" style={{ ...profileAvatar, color: theme.textDim }}>
                  <Icon name="user" size={16} />
                </span>
                <span style={profileIdentity}>
                  <span style={profileName}>{t('Not signed in')}</span>
                  <span style={profileEmail}>{t('Sign in to keep your account and projects together')}</span>
                </span>
              </div>
              <div style={profileActions}>
                <button type="button" style={profileButtonPrimary} onClick={() => setAuthMode('signin')}>
                  {t('Sign in')}
                </button>
                <button type="button" style={profileButton} onClick={() => setAuthMode('signup')}>
                  {t('Sign up')}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.aside>
      <AnimatePresence>
        {authMode && <AuthDialog mode={authMode} onClose={() => setAuthMode(null)} />}
      </AnimatePresence>
    </>
  );
}

export function DashboardTitlebarContent({ model }: { model: DashboardModel }) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const hasNotification = model.notice.visible;
  const dismiss = model.notice.dismiss;
  const openSettings = (): void => { model.setDialog('settings', true); };

  return (
    <>
      <span style={headerRow}>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={t('Menu')}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          data-tip={t('Menu')}
          className="cc-header-btn cc-tip cc-tip-r"
          style={circleButton}
        >
          <Icon name="menu" size={17} />
        </button>
        <span style={searchCapsule}>
          <ProjectSearch value={model.query} onChange={model.setQuery}
            inputStyle={modernSearchInput} />
        </span>
        <span style={{ position: 'relative', flex: '0 0 auto' }}>
          <button
            type="button"
            onClick={() => setBellOpen((open) => !open)}
            aria-label={t('Notifications')}
            aria-haspopup="dialog"
            aria-expanded={bellOpen}
            data-tip={t('Notifications')}
            className={`cc-header-btn cc-tip cc-tip-l${hasNotification ? ' cc-bell-live' : ''}`}
            style={circleButton}
          >
            <Icon name="bell" size={17} />
            {hasNotification && <span aria-hidden="true" style={bellBadge} />}
          </button>
          <AnimatePresence>
            {bellOpen && (
              <motion.div
                role="dialog"
                aria-label={t('Notifications')}
                style={notificationPanel}
                initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.96 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
              >
                {hasNotification ? (
                <button type="button" style={notificationRow}
                  onClick={() => { setBellOpen(false); dismiss(); openSettings(); }}>
                  <strong style={{ fontSize: 12.5 }}>{t('Configure a model to start using the Agent')}</strong>
                  <span style={{ fontSize: 11.5, color: theme.textDim, lineHeight: 1.5 }}>
                    {t('Configure any cloud or local model to use conversational editing in the editor.')}
                  </span>
                </button>
              ) : (
                <div style={notificationEmpty}>{t('No notifications')}</div>
              )}
              </motion.div>
            )}
          </AnimatePresence>
        </span>
        {/* Profile sits in the corner, the way an app shell puts the account. */}
        <button
          type="button"
          onClick={openSettings}
          aria-label={t('Profile')}
          data-tip={t('Profile')}
          className="cc-header-btn cc-tip cc-tip-l"
          style={{ ...circleButton, color: theme.textStrong }}
        >
          <Icon name="user" size={17} />
        </button>
      </span>

      <AnimatePresence>
        {hasNotification && (
          <motion.div
            style={notificationStack}
            initial={reduceMotion ? false : { opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.9 }}
          >
            <div style={notificationCard}>
              <ModelSetupCard onOpen={openSettings} />
              <button
                type="button"
                onClick={dismiss}
                aria-label={t('Close')}
                style={notificationClose}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {menuOpen && <SideMenu model={model} onClose={() => setMenuOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

function ProjectSearch({ value, onChange, style, inputStyle }: {
  value: string; onChange: (value: string) => void; style?: CSSProperties; inputStyle?: CSSProperties;
}) {
  const t = useT();
  return (
    <label style={{ ...searchBox, ...style }}>
      <span style={searchIcon}><Icon name="search" size={13} /></span>
      <input
        type="search"
        aria-label={t('Search projects')}
        placeholder={t('Search projects')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') onChange(''); }}
        onFocus={(event) => {
          const piece = event.currentTarget.closest('span');
          if (piece instanceof HTMLElement) piece.style.background = 'rgba(255,255,255,0.12)';
        }}
        onBlur={(event) => {
          const piece = event.currentTarget.closest('span');
          if (piece instanceof HTMLElement) piece.style.background = 'rgba(255,255,255,0.07)';
        }}
        autoComplete="off"
        spellCheck={false}
        style={{ ...searchInput, ...inputStyle }}
      />
      {value && <button type="button" onClick={() => onChange('')} aria-label={t('Clear search')} style={searchClear}><Icon name="x" size={12} /></button>}
    </label>
  );
}

function ProjectName({ project, model }: { project: ProjectMeta; model: DashboardModel }) {
  const t = useT();
  if (model.rename.editingId === project.id) {
    return <input
      autoFocus
      value={model.rename.draft}
      onChange={(event) => model.rename.setDraft(event.target.value)}
      onBlur={model.rename.commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') model.rename.commit();
        if (event.key === 'Escape') model.rename.cancel();
      }}
      style={nameInput}
    />;
  }
  return <div onDoubleClick={() => model.rename.start(project)} title={t('Double-click to rename')} style={cardName}>{project.name}</div>;
}

function ProjectActions({ project, props, model }: { project: ProjectMeta; props: DashboardProps; model: DashboardModel }) {
  const t = useT();
  if (model.rename.confirmId === project.id) {
    return <button
      onClick={() => {
        void model.transfer.run(props.onDelete(project.id).then(() => t('Permanently deleted "{name}"', { name: project.name })));
        model.rename.setConfirmId(null);
      }}
      disabled={model.transfer.busy}
      style={{ ...miniBtn, width: 'auto', padding: '0 6px', color: theme.danger }}
      title={t('Delete the project and any media only it references')}
    >{t('Confirm delete')}</button>;
  }
  return (
    <>
      <button onClick={() => model.rename.start(project)} style={miniBtn} title={t('Rename')} aria-label={t('Rename')}><Icon name="pencil" size={13} /></button>
      <button onClick={() => props.onDuplicate(project.id)} style={miniBtn} title={t('Duplicate')} aria-label={t('Duplicate')}><Icon name="copy" size={13} /></button>
      <button onClick={() => void model.transfer.run(props.onExport(project.id, project.name))} disabled={model.transfer.busy} style={miniBtn} title={t('Export as streaming .ccproj (includes media)')} aria-label={t('Export as streaming .ccproj')}><Icon name="download" size={13} /></button>
      <button onClick={() => model.rename.setConfirmId(project.id)} style={miniBtn} title={t('Delete')} aria-label={t('Delete')}><Icon name="trash" size={13} /></button>
    </>
  );
}

function ProjectCard({ project, props, model }: { project: ProjectMeta; props: DashboardProps; model: DashboardModel }) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const thumbnail = model.thumbs[project.id];
  return (
    <div
      style={{ ...card, ...(hovered ? cardHover : null) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={() => props.onOpen(project.id)} style={thumb} title={t('Open {name}', { name: project.name })}>
        {thumbnail
          ? <img src={thumbnail} alt="" draggable={false} loading="lazy" decoding="async" style={thumbImage} />
          : <span style={{ color: theme.borderLight, display: 'inline-flex' }}><Icon name="play" size={26} /></span>}
        <span aria-hidden="true" style={{ ...thumbScrim, ...(hovered ? thumbScrimVisible : null) }}>
          <Icon name="play" size={28} />
        </span>
      </button>
      <div style={cardBody}>
        <ProjectName project={project} model={model} />
        <div style={cardMeta}>
          <span style={metaText}>{relativeProjectTime(project.updatedAt, t)}</span>
          <div style={{ ...actionRow, ...(hovered ? actionRowVisible : null) }}>
            <ProjectActions project={project} props={props} model={model} />
          </div>
        </div>
      </div>
    </div>
  );
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Say hello the way the clock does, so the first line is never a label. */
function greeting(t: Translate): string {
  const hour = new Date().getHours();
  if (hour < 5) return t('Good night');
  if (hour < 12) return t('Good morning');
  if (hour < 18) return t('Good afternoon');
  return t('Good evening');
}

/**
 * Tracks whether the launch panel is too narrow for the pill label. A plain
 * ResizeObserver instead of a media query, because the panel sits in a flexible
 * sidebar and its width does not track the window.
 */
function useNarrowPanel(ref: React.RefObject<HTMLElement | null>, threshold = 300): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setNarrow(el.clientWidth > 0 && el.clientWidth < threshold);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, threshold]);
  return narrow;
}

interface LaunchTileProps {
  tint: keyof typeof LAUNCH_TINTS;
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  hint: string;
  disabled?: boolean;
  onActivate: () => void;
}

function LaunchTile({ tint, icon, label, hint, disabled, onActivate }: LaunchTileProps) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const accent = LAUNCH_TINTS[tint];
  const lit = hovered && !disabled;
  return (
    <button
      type="button"
      onClick={onActivate}
      disabled={disabled}
      title={t(label)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{ ...launchTile(accent, lit), ...(disabled ? { opacity: 0.5, cursor: 'default' } : null) }}
    >
      <span aria-hidden="true" style={launchIcon(accent.ink)}>
        <AnimatedIcon name={icon} size={14} active={lit} />
      </span>
      <span style={launchBody}>
        <span style={launchLabel}>{t(label)}</span>
        <span style={launchSub}>{t(hint)}</span>
      </span>
    </button>
  );
}

/**
 * The four ways into the app. No box: a greeting, the primary action, then the
 * canvas choices as flat tiles, so nothing competes with the project grid.
 */
function LaunchPanel({ props, model }: { props: DashboardProps; model: DashboardModel }) {
  const t = useT();
  const panelRef = useRef<HTMLElement>(null);
  const narrow = useNarrowPanel(panelRef);
  const [primaryHovered, setPrimaryHovered] = useState(false);
  const [workflowHovered, setWorkflowHovered] = useState(false);
  const create = (preset?: NewProjectPreset) => () => props.onNew(preset);
  const projectCount = model.visibleProjects.length;
  const hello = greeting(t);
  return (
    <section ref={panelRef} aria-label={t('Start something new')} style={launchPanel}>
      <div style={narrow ? { ...launchTop, gap: 10, paddingBottom: 14 } : launchTop}>
        <div style={launchGreeting}>
          <span style={narrow ? { ...greetingText, fontSize: 18 } : greetingText} title={hello}>
            {hello}
          </span>
          <span style={greetingHint}>
            {projectCount === 0
              ? t('Nothing here yet — start your first project')
              : t('{n} projects · pick up where you left off', { n: projectCount })}
          </span>
        </div>
        <button
          type="button"
          onClick={create()}
          aria-label={t('New project')}
          title={t('New project')}
          onMouseEnter={() => setPrimaryHovered(true)}
          onMouseLeave={() => setPrimaryHovered(false)}
          onFocus={() => setPrimaryHovered(true)}
          onBlur={() => setPrimaryHovered(false)}
          style={{
            ...newProjectButton,
            ...(narrow ? newProjectButtonCompact : null),
            ...(primaryHovered ? newProjectButtonHover : null),
          }}
        >
          <AnimatedIcon name="plus" size={15} active={primaryHovered} tilt={90} />
          {!narrow && <span>{t('New project')}</span>}
        </button>
      </div>
      <div style={launchGrid}>
        <LaunchTile tint="video" icon="video" label="New video" hint="16:9 · 1080p" onActivate={create('video')} />
        <LaunchTile tint="photo" icon="image" label="New photo" hint="1:1 · 1080" onActivate={create('photo')} />
        <LaunchTile tint="project" icon="plus" label="New project" hint="Blank" onActivate={create()} />
        <LaunchTile
          tint="import" icon="upload" label="Import" hint=".ccproj"
          disabled={model.transfer.busy}
          onActivate={() => model.transfer.fileRef.current?.click()}
        />
      </div>
      <button
        type="button"
        onClick={() => model.setDialog('workflow', true)}
        onMouseEnter={() => setWorkflowHovered(true)}
        onMouseLeave={() => setWorkflowHovered(false)}
        onFocus={() => setWorkflowHovered(true)}
        onBlur={() => setWorkflowHovered(false)}
        style={workflowButton(workflowHovered)}
      >
        <span aria-hidden="true" style={workflowButtonIcon}>
          <AnimatedIcon name="wand" size={14} active={workflowHovered} tilt={-14} />
        </span>
        <span style={workflowButtonBody}>
          <span style={workflowButtonLabel}>{t('Workflow')}</span>
          <span style={workflowButtonHint}>{t('Pick how the agent plans the edit')}</span>
        </span>
        <span aria-hidden="true" style={workflowButtonChevron}><Icon name="chevronDown" size={14} /></span>
      </button>
    </section>
  );
}

function ProjectGrid({ props, model }: { props: DashboardProps; model: DashboardModel }) {
  const t = useT();
  return (
    <>
      <div style={projectSectionHead}>
        <span style={projectSectionTitle}>{t('Projects')}</span>
        <span style={projectSectionCount}>{model.visibleProjects.length}</span>
      </div>
      <div style={grid}>
        {model.visibleProjects.map((project) => <ProjectCard key={project.id} project={project} props={props} model={model} />)}
      </div>
      {model.normalizedQuery && model.visibleProjects.length === 0 && (
        <div role="status" style={emptyState}><Icon name="search" size={14} />{t('No projects match "{query}"', { query: model.query.trim() })}</div>
      )}
    </>
  );
}

function HomeBottomNav({ model, onHome }: { model: DashboardModel; onHome: () => void }) {
  const t = useT();
  const [hovered, setHovered] = useState<string | null>(null);
  const hoverProps = (id: string) => ({
    onMouseEnter: () => setHovered(id),
    onMouseLeave: () => setHovered(null),
    onFocus: () => setHovered(id),
    onBlur: () => setHovered(null),
  });
  // FreeCut's rail: a full-width centred wrapper with a capped pill inside, and
  // equal-flex capsules that stack icon over label. Nothing here is a fixed
  // width, so the nav fits any screen instead of running off the edge.
  const tabs: { id: string; icon: Parameters<typeof Icon>[0]['name']; label: string; onActivate: () => void }[] = [
    { id: 'home', icon: 'home', label: t('Home'), onActivate: onHome },
    {
      id: 'agent',
      icon: 'agentMark',
      label: t('Agent'),
      // The agent only exists inside a project; without a model there is nothing
      // to talk to, so send people straight to the place that fixes that.
      onActivate: () => {
        if (model.modelSnapshot.choices.length === 0) {
          model.setDialog('settings', true);
          return;
        }
        showAppToast(t('Open a project to work with the agent'));
      },
    },
    { id: 'assets', icon: 'folder', label: t('Assets'), onActivate: () => model.setDialog('cleanup', true) },
    {
      id: 'circle',
      icon: 'users',
      label: t('Circle'),
      onActivate: () => showAppToast(t('Circle is coming soon — a shared space for templates and cuts')),
    },
  ];
  return (
    <div style={bottomNavWrap}>
      <nav aria-label={t('Main navigation')} style={bottomNav}>
        {tabs.map((tab) => {
          const current = tab.id === 'home';
          return (
            <button
              key={tab.id}
              type="button"
              onClick={tab.onActivate}
              aria-current={current ? 'page' : undefined}
              title={tab.id === 'circle' ? t('Circle · coming soon') : tab.label}
              style={navTab}
              {...hoverProps(tab.id)}
            >
              <span style={current ? navCapsule(true, hovered === tab.id) : navCapsule(false, hovered === tab.id)}>
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <Icon name={tab.icon} size={16} />
                  {tab.id === 'circle' && <span aria-hidden="true" style={navSoonDot} />}
                </span>
                <span style={navLabel}>{tab.label}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function DashboardContent({ props, model }: { props: DashboardProps; model: DashboardModel }) {
  const scrollRef = useRef<HTMLElement>(null);
  // The notice floats over the page, so the first screen starts below it instead
  // of sliding the launch panel's heading underneath the card.
  const containerStyle = model.notice.visible
    ? { ...container, paddingTop: NOTICE_CLEARANCE }
    : container;
  return (
    <>
      <main ref={scrollRef} style={shell}>
        <div style={containerStyle}>
          {/* The import action lives in the bottom nav; this is the input it drives. */}
          <input ref={model.transfer.fileRef} type="file" accept=".ccproj,.json,application/json,application/x-afterframe-project" onChange={model.transfer.pickImport} style={{ display: 'none' }} />
          <LaunchPanel props={props} model={model} />
          <ProjectGrid props={props} model={model} />
        </div>
      </main>
      <AppToastHost />
      <div aria-hidden="true" style={bottomGlow} />
      <HomeBottomNav model={model} onHome={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
    </>
  );
}

export function DashboardDialogs({ model, onCreateWithWorkflow }: {
  model: DashboardModel;
  onCreateWithWorkflow: (workflowId: string) => void;
}) {
  // The settings dialog's Anthropic pane summons the MCP guide through the
  // action registry; in the editor the top bar answers, here the dashboard's
  // own dialog state does. Without this the button silently does nothing on
  // the projects page, which is exactly where a new user starts.
  useEffect(() => bindAction('open-mcp-guide', () => model.setDialog('mcp', true)), [model]);
  useDashboardDialogPrefetch();
  return (
    // No fallback: a dialog that is still loading shows nothing, exactly as it
    // did before it was opened. The idle prefetch keeps that window tiny.
    <Suspense fallback={null}>
      {model.dialogs.settings && <SettingsDialog onClose={() => model.setDialog('settings', false)} />}
      {model.dialogs.shortcuts && <ShortcutsDialog onClose={() => model.setDialog('shortcuts', false)} />}
      {model.dialogs.mcp && <McpGuideDialog onClose={() => model.setDialog('mcp', false)} />}
      {model.dialogs.cleanup && <MediaCleanupDialog onClose={() => model.setDialog('cleanup', false)} />}
      {model.dialogs.workflow && (
        <WorkflowDialog
          onClose={() => model.setDialog('workflow', false)}
          onPick={(workflowId) => { model.setDialog('workflow', false); onCreateWithWorkflow(workflowId); }}
        />
      )}
    </Suspense>
  );
}
