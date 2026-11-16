import { lazy, Suspense, useEffect, useState } from 'react';
import { Dashboard } from '../components/Dashboard';
import type { ProjectDoc } from '../editor/types';
import { useT } from '../i18n/locale';
import { loadProjectForEditing, renameProject } from '../persist/projectStore';
import type { ProjectMeta } from '../persist/projectStoreCoordinators';
import { theme, themeAlpha } from '../theme';
import { emptyProjectDoc, navigateTo, type AppRoute } from './appShell';
import { editorAccess } from './editorAccess';
import { EditorErrorBoundary, SecureContextRequiredView } from './EditorGuards';
import { useDashboardActions } from './useDashboardActions';

const Editor = lazy(() => import('../Editor'));

export function AppSplash({ text, progress }: { text: string; progress?: number }) {
  const pct = progress === undefined ? null : Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div style={{
      height: '100vh', display: 'grid', placeItems: 'center', background: theme.bg,
      color: theme.textDim, fontFamily: 'var(--cc-font)', fontSize: 13,
    }}>
      <div style={{ display: 'grid', gap: 12, justifyItems: 'center', width: 200 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em' }}>
          {pct === null ? text : `${text} ${pct}%`}
        </span>
        {pct !== null && (
          <span
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={text}
            style={{
              display: 'block', width: '100%', height: 3, borderRadius: 999,
              background: themeAlpha.ink(0.14), overflow: 'hidden',
            }}
          >
            <span style={{
              display: 'block', height: '100%', width: `${pct}%`, borderRadius: 999,
              background: theme.text, transition: 'width 240ms cubic-bezier(0.22, 1, 0.36, 1)',
            }} />
          </span>
        )}
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
  if (load.kind === 'loading') return <AppSplash text={t('加载工程…')} progress={Math.min(progress, 38)} />;
  if (load.kind === 'unreadable') {
    return (
      <div style={{
        height: '100vh', display: 'grid', placeItems: 'center', background: theme.bg,
        fontFamily: 'var(--cc-font)',
      }}>
        <div style={{ display: 'grid', gap: 10, justifyItems: 'center', maxWidth: 420, textAlign: 'center' }}>
          <b style={{ color: theme.text, fontSize: 14 }}>{t('工程数据暂时无法读取')}</b>
          <span style={{ color: theme.textDim, fontSize: 12.5, lineHeight: 1.6 }}>
            {t('为避免覆盖已保存的内容，已停止打开该工程。数据仍保留在本机存储中，可稍后重试。')}
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
              {t('重试')}
            </button>
            <button
              type="button"
              onClick={onHome}
              style={{
                padding: '6px 14px', borderRadius: 6, border: `0.5px solid ${theme.border}`,
                background: 'transparent', color: theme.text, fontSize: 12.5, cursor: 'pointer',
              }}
            >
              {t('返回工程列表')}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <EditorErrorBoundary translate={t} onHome={onHome}>
      <Suspense fallback={<AppSplash text={t('加载编辑器…')} progress={progress} />}>
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
    return <AppSplash text={t('工程不存在，返回…')} />;
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
  return <Dashboard projects={projects} {...actions} />;
}
