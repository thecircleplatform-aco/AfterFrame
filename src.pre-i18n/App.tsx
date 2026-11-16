
import { useEffect } from 'react';
import { useT } from './i18n/locale';
import {
  navigateTo,
  useAgentBackendSync,
  useAppRoute,
  useProjects,
} from './app/appShell';
import { AppSplash, DashboardRoute, EditorRoute } from './app/AppViews';
import { AfterFrameIntro } from './components/brand/afterframe-intro';
import { AuthPage } from './components/auth/AuthPage';
import { GoogleCallbackPage } from './components/auth/GoogleCallbackPage';
import { ResetPasswordPage } from './components/auth/ResetPasswordPage';
import { useAuthSession } from './auth/session';
import { useInferenceWarmup } from './hooks/useInferenceWarmup';
import { useUiScaleShortcuts } from './hooks/useUiScaleShortcuts';
import { InstallPrompt } from './components/pwa/InstallPrompt';

export default function App() {
  const t = useT();
  const route = useAppRoute();
  const auth = useAuthSession();
  useAgentBackendSync();
  // No warmup where the editor can't open (insecure context, see editorAccess).
  useInferenceWarmup(route.name === 'editor' && window.isSecureContext);
  useUiScaleShortcuts();
  const { projects, refresh } = useProjects();

  const wantsAuthPage = route.name === 'signin' || route.name === 'signup' || route.name === 'reset';
  // `unavailable` means there is no auth backend to ask (local dev, Electron),
  // and locking someone out of their own machine over that is not acceptable.
  const mustSignIn = auth.status === 'signedOut';
  // Google sends the browser back to `/` with a code; that leg is neither a page
  // nor a redirect target, so it is detected once and handled before the gate.
  const googleReturn = new URLSearchParams(window.location.search).has('code');

  // Keep the address bar honest: a signed-out visitor always lands on a form,
  // and a signed-in visitor never stays on one.
  useEffect(() => {
    if (googleReturn) return;
    if (mustSignIn && !wantsAuthPage) navigateTo('#/signin');
    if (auth.status === 'signedIn' && wantsAuthPage) navigateTo('#/');
  }, [auth.status, mustSignIn, wantsAuthPage, googleReturn]);

  const body = auth.status === 'loading' || !projects ? (
    <AppSplash text={t('加载中…')} />
  ) : googleReturn ? (
    <GoogleCallbackPage search={window.location.search} />
  ) : route.name === 'reset' ? (
    <ResetPasswordPage token={route.token} />
  ) : mustSignIn || (auth.status !== 'signedIn' && wantsAuthPage) ? (
    <AuthPage mode={route.name === 'signup' ? 'signup' : 'signin'} />
  ) : route.name === 'editor' ? (
    <EditorRoute route={route} projects={projects} refresh={refresh} />
  ) : (
    <DashboardRoute projects={projects} refresh={refresh} />
  );

  // The boot preload's visual is static markup in index.html, so it animates
  // from the first paint. This plays its finale once the app is mounted behind
  // it, then removes the node. Mounted here (not in a route) so it runs on page
  // load only and never on client-side navigation.
  return (
    <>
      {body}
      <InstallPrompt />
      <AfterFrameIntro />
    </>
  );
}