import { lazy, Suspense, useEffect, useState } from 'react';
import { Dashboard } from '../components/Dashboard';
import { AfterFrameLogo } from '../components/brand/afterframe-logo';
import type { ProjectDoc } from '../editor/types';
import { useT } from '../i18n/locale';
import { loadProjectForEditing, renameProject } from '../persist/projectStore';
import type { ProjectMeta } from '../persist/projectStoreCoordinators';
import { theme } from '../theme';
import { emptyProjectDoc, navigateTo, type AppRoute } from './appShell';
import { editorAccess } from './editorAccess';
import { EditorErrorBoundary, SecureContextRequiredView } from './EditorGuards';
import { useDashboardActions } from './useDashboardActions';

const Editor = lazy(() => import('../Editor'));

/**
 * The preload shown while the editor chunk and project data are still arriving.
 *
 * This replaces a bare grey "Loading editor… 44%" line with a 200×3px bar. Two
 * things were wrong with that: it carried no brand, and a stuck-at-44% counter
 * reads as broken even when loading is healthy. So:
 *
 * - The lockup is the real `AfterFrameLogo`, so the wait still looks like the
 *   product rather than a browser placeholder.
 * - The headline names what is actually happening (`stage`), because "Loading"
 *   is the answer to a question the user did not ask.
 * - The bar is indeterminate until a real number arrives. A determinate bar that
 *   sits at 44% is a lie about progress; motion that never claims a position is
 *   honest. Once `progress` is supplied it eases to that value.
 * - A short delay before appearing avoids a one-frame white flash on fast loads.
 */
export function AppSplash({
  text, progress, stage,
}: {
  text: string;
  progress?: number;
  /** What is being worked on right now, e.g. "Restoring your media". */
  stage?: string;
}) {
  const t = useT();
  const pct = progress === undefined ? null : Math.max(0, Math.min(100, Math.round(progress)));

  // Keep the last determinate value so the bar never snaps backwards when a
  // stage reports a lower number than the previous one.
  const [ceiling, setCeiling] = useState(0);
  useEffect(() => {
    if (pct === null) return;
    setCeiling((current) => Math.max(current, pct));
  }, [pct]);

  return (
    <div className="cc-splash" role="status" aria-live="polite" aria-label={text}>
      <div className="cc-splash-inner">
        <div className="cc-splash-mark">
          <AfterFrameLogo size="lg" />
        </div>

        <p className="cc-splash-headline">{stage ?? text}</p>

        <div
          className={`cc-splash-track${ceiling === null ? '' : ' is-determined'}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          {...(ceiling > 0 ? { 'aria-valuenow': ceiling } : {})}
          aria-label={text}
        >
          {ceiling > 0 ? (
            <span className="cc-splash-fill" style={{ width: `${ceiling}%` }} />
          ) : (
            <span className="cc-splash-runner" />
          )}
        </div>

        <div className="cc-splash-meta">
          <span className="cc-splash-note">{t('Getting your workspace ready')}</span>
          {ceiling > 0 && <span className="cc-splash-pct">{ceiling}%</span>}
        </div>
      </div>
    </div>
  );
}

interface EditorLoaderProps {
  meta: ProjectMeta;
  onHome: () => void;
  onRename: (name: string) => void;
}

type EditorLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; doc: ProjectDoc }
  | { kind: 'unreadable' };

function EditorLoader({ meta, onHome, onRename }: EditorLoaderProps) {
  const t = useT();
  const [load, setLoad] = useState<EditorLoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Milestone-driven, never guessed from a timer alone: 0 → 8 on mount, 40 once the
  // saved document is in hand, then the last stretch while the editor chunk is
  // still streaming. It is capped below 100 so the bar can never sit at 100%
  // while nothing has rendered — the splash disappears when the editor mounts.
  const [progress, setProgress] = useState(8);
  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    void loadProjectForEditing(meta.id).then((result) => {
      if (!alive) return;
      // "missing" opens a legitimately empty project; "unreadable" must block
      // the editor — opening it empty would let autosave overwrite real data.
      if (result.status === 'ok') setLoad({ kind: 'ready', doc: result.doc });
      else if (result.status === 'missing') setLoad({ kind: 'ready', doc: emptyProjectDoc() });
      else setLoad({ kind: 'unreadable' });
    });
    return () => { alive = false; };
  }, [meta.id, attempt]);
  useEffect(() => {
    if (load.kind === 'ready') setProgress((p) => Math.max(p, 40));
  }, [load]);
  useEffect(() => {
    if (load.kind !== 'ready') return undefined;
    const id = window.setInterval(() => {
      setProgress((p) => (p >= 92 ? p : p + Math.max(0.5, (92 - p) * 0.07)));
    }, 180);
    return () => window.clearInterval(id);
  }, [load.kind]);
  if (load.kind === 'loading') {
    return <AppSplash
      text={t('Loading project…')}
      stage={t('Restoring your project')}
      progress={Math.min(progress, 38)}
    />;
  }
  if (load.kind === 'unreadable') {
    return (
      <div style={{
        height: '100vh', display: 'grid', placeItems: 'center', background: theme.bg,
        fontFamily: 'var(--cc-font)',
      }}>
        <div style={{ display: 'grid', gap: 10, justifyItems: 'center', maxWidth: 420, textAlign: 'center' }}>
          <b style={{ color: theme.text, fontSize: 14 }}>{t('Project data is temporarily unreadable')}</b>
          <span style={{ color: theme.textDim, fontSize: 12.5, lineHeight: 1.6 }}>
            {t('Opening was stopped to avoid overwriting your saved work. The data is still in local storage — try again shortly.')}
          </span>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: `0.5px solid ${theme.border}`,
                background: theme.accent, color: theme.bg, fontSize: 12.5, cursor: 'pointer',
              }}
            >
              {t('Retry')}
            </button>
            <button
              type="button"
              onClick={onHome}
              style={{
                padding: '6px 14px', borderRadius: 6, border: `0.5px solid ${theme.border}`,
                background: 'transparent', color: theme.text, fontSize: 12.5, cursor: 'pointer',
              }}
            >
              {t('Back to projects')}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <EditorErrorBoundary translate={t} onHome={onHome}>
      <Suspense fallback={<AppSplash
        text={t('Loading editor…')}
        stage={t('Building the timeline')}
        progress={progress}
      />}>
        <Editor initial={load.doc} project={meta} onHome={onHome} onRename={onRename} />
      </Suspense>
    </EditorErrorBoundary>
  );
}

interface EditorRouteProps {
  route: Extract<AppRoute, { name: 'editor' }>;
  projects: ProjectMeta[];
  refresh: () => Promise<void>;
}

export function EditorRoute({ route, projects, refresh }: EditorRouteProps) {
  const t = useT();
  const meta = projects.find((project) => project.id === route.id);
  if (!meta) {
    navigateTo('#/');
    return <AppSplash text={t('Project not found, going back…')} />;
  }
  // Decide before the editor chunk is requested: outside a secure context it cannot run.
  const access = editorAccess(window.isSecureContext, window.location.origin);
  if (access.kind === 'insecure-context') {
    return <SecureContextRequiredView origin={access.origin} translate={t} onHome={() => navigateTo('#/')} />;
  }
  return (
    <EditorLoader
      key={meta.id}
      meta={meta}
      onHome={() => navigateTo('#/')}
      onRename={async (name) => { await renameProject(meta.id, name); refresh(); }}
    />
  );
}

export function DashboardRoute({
  projects,
  refresh,
}: {
  projects: ProjectMeta[];
  refresh: () => Promise<void>;
}) {
  const actions = useDashboardActions(refresh);
  return <Dashboard projects={projects} {...actions} onProjectsChanged={refresh} />;
}
