// Account state for the whole app, kept deliberately small: one fetch to
// `/auth/me` at start-up, then sign-in / sign-up / sign-out calls that rewrite the
// same snapshot. No React context — the drawer footer and the auth dialog both
// subscribe through `useAuthSession`.
//
// The browser never talks to the worker directly: `/auth/*` is a same-origin proxy
// (functions/auth/[[path]].js) so the session cookie stays first-party. Local dev
// has no such route, which resolves to "signed out" like any other non-200.
import { useSyncExternalStore } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser }
  // No auth backend reachable: local dev, the Electron shell, or a deployment
  // without the `/auth/*` proxy. The app must stay usable there, so the gate
  // treats this as "cannot ask" rather than "not allowed".
  | { status: 'unavailable' };

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; message: string };

const AUTH_BASE = String(
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_AUTH_API_URL ?? '',
).replace(/\/+$/, '');

const SIGNED_OUT: AuthState = { status: 'signedOut' };
const UNAVAILABLE: AuthState = { status: 'unavailable' };

let state: AuthState = { status: 'loading' };
const listeners = new Set<() => void>();

function publish(next: AuthState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot(): AuthState {
  return state;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${AUTH_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readUser(response: Response): Promise<AuthResult> {
  const payload = await response.json().catch(() => ({})) as { user?: AuthUser; message?: string };
  if (response.ok && payload.user) {
    publish({ status: 'signedIn', user: payload.user });
    return { ok: true, user: payload.user };
  }
  return { ok: false, message: payload.message ?? 'Something went wrong. Try again.' };
}

/** Ask the proxy who we are. Safe to call more than once; it just republishes. */
export async function refreshAuth(): Promise<void> {
  try {
    const response = await fetch(`${AUTH_BASE}/auth/me`, { credentials: 'include' });
    // 401 means "no session"; anything else non-OK means "no auth service here".
    if (response.status === 401) { publish(SIGNED_OUT); return; }
    if (!response.ok) { publish(UNAVAILABLE); return; }
    const payload = await response.json().catch(() => ({})) as { user?: AuthUser };
    publish(payload.user ? { status: 'signedIn', user: payload.user } : SIGNED_OUT);
  } catch {
    // Offline or no proxy in dev: don't lock the user out of their own machine.
    publish(UNAVAILABLE);
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    return await readUser(await postJson('/auth/login', { email, password }));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Network error.' };
  }
}

export async function signUp(email: string, password: string, name?: string): Promise<AuthResult> {
  try {
    return await readUser(await postJson('/auth/signup', { email, password, name }));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Network error.' };
  }
}

export async function signOut(): Promise<void> {
  try {
    await postJson('/auth/logout', {});
  } catch {
    // The local session is cleared regardless; a failed logout must not strand it.
  }
  publish(SIGNED_OUT);
}

/**
 * Ask for a reset link. The worker answers `{ ok: true }` whether or not the
 * address exists, so this never leaks which accounts are real. In local dev it
 * also returns the link, because nothing would deliver mail there.
 */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; link?: string }> {
  try {
    const response = await postJson('/auth/forgot-password', { email });
    const payload = await response.json().catch(() => ({})) as { link?: string };
    return { ok: response.ok, ...(payload.link ? { link: payload.link } : {}) };
  } catch {
    // Same answer as a missing account: the caller shows one neutral message.
    return { ok: true };
  }
}

/** Spend a single-use token on a new password. The worker kills every existing
 *  session on success, so the user signs in again afterwards. */
export async function resetPassword(token: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await postJson('/auth/reset-password', { token, password });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; message?: string };
    if (response.ok && payload.ok) return { ok: true };
    return { ok: false, message: payload.message ?? 'This reset link is no longer valid.' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Network error.' };
  }
}

/** Subscribe a component to the account snapshot. */
export function useAuthSession(): AuthState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// ---- Google sign-in --------------------------------------------------------
// Authorization Code + PKCE, handled entirely in the browser: Google redirects
// back to this origin with `?code=...`, and the code is exchanged through the
// same-origin `/auth/*` proxy so the secret never reaches the client.

const OAUTH_STATE_KEY = 'af.oauth.state';
const OAUTH_VERIFIER_KEY = 'af.oauth.verifier';

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** True when this build knows a Google client id (otherwise the button is hidden). */
export function googleSignInAvailable(): boolean {
  return Boolean((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CLIENT_ID);
}

/** Redirect the browser to Google, remembering state + PKCE verifier for the return leg. */
export async function startGoogleAuth(): Promise<void> {
  const clientId = (import.meta as unknown as { env?: Record<string, string | undefined> })
    .env?.VITE_GOOGLE_CLIENT_ID ?? '';
  if (!clientId) throw new Error('Google sign-in is not configured in this build.');

  const state = crypto.randomUUID();
  const verifier = base64UrlFromBytes(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));

  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${window.location.origin}/`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: base64UrlFromBytes(new Uint8Array(digest)),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

/** Finish the redirect leg: verify our own state, then trade the code for a session. */
export async function completeGoogleAuth(search: string): Promise<AuthResult> {
  const params = new URLSearchParams(search);
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  const expected = sessionStorage.getItem(OAUTH_STATE_KEY) ?? '';
  const verifier = sessionStorage.getItem(OAUTH_VERIFIER_KEY) ?? '';
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_VERIFIER_KEY);

  if (params.get('error')) {
    return { ok: false, message: 'Google sign-in was cancelled.' };
  }
  if (!code || !state || !expected || state !== expected) {
    return { ok: false, message: 'That sign-in link is not valid. Try again.' };
  }

  try {
    return await readUser(await postJson('/auth/google/exchange', {
      code,
      redirectUri: `${window.location.origin}/`,
      codeVerifier: verifier,
    }));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Network error.' };
  }
}

/** Two initials for the avatar, falling back to the address's first letter. */
export function userInitials(user: AuthUser): string {
  const source = user.name?.trim() || user.email;
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

if (typeof window !== 'undefined') {
  void refreshAuth();
}
