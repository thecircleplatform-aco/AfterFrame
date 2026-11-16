import { theme } from '../theme';
import { UpstreamUpdateNotice } from '../ui/UpstreamUpdateNotice';
import { DesktopWindowControls } from './DesktopWindowControls';
import {
  DashboardContent,
  DashboardDialogs,
  DashboardTitlebarContent,
} from './dashboard/DashboardViews';
import { useDashboardModel, type DashboardProps } from './dashboard/useDashboardModel';

export function Dashboard(props: DashboardProps) {
  const model = useDashboardModel(props);
  const isMacDesktop = window.AfterFrameDesktop?.platform === 'darwin';
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: theme.bg, color: theme.text, fontFamily: 'var(--cc-font)' }}>
      <UpstreamUpdateNotice />
      {/* The titlebar is no longer a band: it has no background and takes no
          height in the column, so the three glass pieces float over the
          scrolling dashboard. The band itself is click-through; only the
          pieces accept the pointer. */}
      <header className={`cc-window-titlebar${isMacDesktop ? ' cc-window-titlebar--mac' : ''}`} style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, height: 60, display: 'flex', alignItems: 'center', gap: 10, padding: '4px 24px 0', background: 'transparent', pointerEvents: 'none' }}>
        <DesktopWindowControls />
        <DashboardTitlebarContent model={model} />
      </header>
      <DashboardContent props={props} model={model} />
      <DashboardDialogs model={model} onCreateWithWorkflow={(workflowId) => props.onNew(undefined, workflowId)} />
    </div>
  );
}
