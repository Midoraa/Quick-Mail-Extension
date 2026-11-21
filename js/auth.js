import {
  clearAllUserData,
  getAuthState,
  getSettings,
  saveAuthState
} from './storage.js';

export const PLACEHOLDER_CLIENT_ID_PREFIX = 'YOUR_GOOGLE_OAUTH_CLIENT_ID';

/**
 * Return manifest `oauth2` block safely.
 * @returns {{ client_id?: string, scopes?: string[] }}
 */
export function getManifestOAuth() {
  return chrome.runtime.getManifest?.()?.oauth2 || {};
}

/**
 * Check whether a client ID string looks configured (non-empty and not the placeholder).
 * @param {string} clientId
 * @returns {boolean}
 */
export function isValidClientId(clientId) {
  const trimmed = String(clientId || '').trim();
  return Boolean(trimmed) && !trimmed.startsWith(PLACEHOLDER_CLIENT_ID_PREFIX);
}

/**
 * Synchronous check for whether `manifest.json` still has the placeholder Client ID.
 * @returns {boolean}
 */
export function isManifestClientIdConfigured() {
  return isValidClientId(getManifestOAuth().client_id);
}

/**
 * Async check for whether either `manifest.json` or saved Web Client ID is configured.
 * @returns {Promise<boolean>}
 */
export async function isClientIdConfigured() {
  if (isManifestClientIdConfigured()) return true;
  const settings = await getSettings();
  return isValidClientId(settings.webClientId);
}

/**
 * Detect Microsoft Edge (Chromium) where `chrome.identity.getAuthToken` is unsupported.
 * @returns {boolean}
 */
export function isEdgeBrowser() {
  return /\bEdg\//.test(globalThis.navigator?.userAgent || '');
}

/**
 * Return the OAuth2 redirect URL required for `launchWebAuthFlow` on Edge / Web OAuth clients.
 * @returns {string}
 */
export function getRedirectUrl() {
  try {
    return chrome.identity?.getRedirectURL?.() || '';
  } catch {
    return '';
  }
}

/**
 * Generate a cryptographic random state token for OAuth2 CSRF protection.
 * @returns {string}
 */
function generateOAuthState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function createAuthError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function isUserCancelMessage(message) {
  return /cancel|denied|did not approve|rejected|user closed|access_denied/i.test(message || '');
}

/**
 * Wrap `chrome.identity.getAuthToken` in a Promise.
 * @param {boolean} interactive
 * @returns {Promise<string>}
 */
function getChromeIdentityToken(interactive) {
  return new Promise((resolve, reject) => {
    if (typeof chrome.identity?.getAuthToken !== 'function') {
      reject(createAuthError('GET_AUTH_TOKEN_UNAVAILABLE', 'getAuthToken is unavailable.'));
      return;
    }

    chrome.identity.getAuthToken({ interactive }, (result) => {
      const lastErr = chrome.runtime.lastError;
      if (lastErr) {
        const msg = lastErr.message || 'getAuthToken failed';
        if (isUserCancelMessage(msg)) {
          reject(createAuthError('USER_CANCELLED', msg));
        } else {
          reject(createAuthError('GET_AUTH_TOKEN_FAILED', msg));
        }
        return;
      }

      const token = typeof result === 'string' ? result : result?.token;
      if (!token) {
        reject(createAuthError('AUTH_REQUIRED', 'No token returned.'));
        return;
      }
      resolve(token);
    });
  });
}

/**
 * Run OAuth2 implicit flow via `chrome.identity.launchWebAuthFlow` (Edge and Chrome fallback).
 * @param {{ interactive: boolean, clientId: string, scopes: string[] }} opts
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
function runWebAuthFlow({ interactive, clientId, scopes }) {
  return new Promise((resolve, reject) => {
    if (typeof chrome.identity?.launchWebAuthFlow !== 'function') {
      reject(createAuthError('AUTH_UNSUPPORTED', 'chrome.identity.launchWebAuthFlow is unavailable.'));
      return;
    }

    const redirectUri = getRedirectUrl();
    const state = generateOAuthState();
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('include_granted_scopes', 'true');
    authUrl.searchParams.set('prompt', interactive ? 'select_account' : 'none');

    chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive }, (callbackUrl) => {
      const lastErr = chrome.runtime.lastError;
      if (lastErr) {
        const msg = lastErr.message || 'launchWebAuthFlow failed';
        if (isUserCancelMessage(msg)) {
          reject(createAuthError('USER_CANCELLED', msg));
        } else if (!interactive) {
          reject(createAuthError('AUTH_REQUIRED', msg));
        } else {
          reject(createAuthError('AUTH_FAILED', msg));
        }
        return;
      }

      if (!callbackUrl) {
        reject(createAuthError(interactive ? 'USER_CANCELLED' : 'AUTH_REQUIRED', 'Empty OAuth callback URL.'));
        return;
      }

      let parsed;
      try {
        parsed = new URL(callbackUrl);
      } catch {
        reject(createAuthError('AUTH_FAILED', 'Invalid OAuth redirect URL.'));
        return;
      }

      const fragmentParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      const queryParams = parsed.searchParams;
      const oauthError = fragmentParams.get('error') || queryParams.get('error');

      if (oauthError) {
        if (isUserCancelMessage(oauthError)) {
          reject(createAuthError('USER_CANCELLED', oauthError));
        } else if (!interactive) {
          reject(createAuthError('AUTH_REQUIRED', oauthError));
        } else {
          reject(createAuthError('AUTH_FAILED', oauthError));
        }
        return;
      }

      const returnedState = fragmentParams.get('state');
      if (returnedState !== state) {
        reject(createAuthError('STATE_MISMATCH', 'OAuth state mismatch.'));
        return;
      }

      const accessToken = fragmentParams.get('access_token');
      const expiresInSec = Number.parseInt(fragmentParams.get('expires_in') || '3600', 10);
      if (!accessToken) {
        reject(createAuthError('AUTH_FAILED', 'Access token missing from OAuth response.'));
        return;
      }

      const expiresAt = Date.now() + (Number.isFinite(expiresInSec) ? expiresInSec : 3600) * 1000;
      resolve({ token: accessToken, expiresAt });
    });
  });
}

/**
 * Acquire an OAuth2 access token across Chrome and Microsoft Edge.
 * @param {{ interactive?: boolean }} [options]
 * @returns {Promise<{ token: string, authMethod: 'getAuthToken' | 'webAuthFlow' }>}
 */
export async function getAuthToken({ interactive = false } = {}) {
  const manifestOAuth = getManifestOAuth();
  const settings = await getSettings();
  const manifestClientId = (manifestOAuth.client_id || '').trim();
  const webClientId = settings.webClientId || (isValidClientId(manifestClientId) ? manifestClientId : '');
  const scopes = Array.isArray(manifestOAuth.scopes) && manifestOAuth.scopes.length > 0
    ? manifestOAuth.scopes
    : ['https://www.googleapis.com/auth/gmail.modify'];

  const configured = isValidClientId(manifestClientId) || isValidClientId(webClientId);
  if (!configured) {
    throw createAuthError(
      'CLIENT_ID_NOT_CONFIGURED',
      'Google OAuth Client ID is not configured in manifest.json or Settings.'
    );
  }

  const cachedAuth = await getAuthState();
  const hasValidWebToken = Boolean(
    cachedAuth?.accessToken &&
    Number(cachedAuth.expiresAt) > Date.now() + 60_000
  );

  // On Chrome, prefer native chrome.identity.getAuthToken unless user previously authenticated via webAuthFlow
  // or manifest client_id is only supplied as a webClientId.
  const canUseChromeGetAuthToken =
    !isEdgeBrowser() &&
    typeof chrome.identity?.getAuthToken === 'function' &&
    isValidClientId(manifestClientId) &&
    cachedAuth?.authMethod !== 'webAuthFlow';

  if (canUseChromeGetAuthToken) {
    try {
      const token = await getChromeIdentityToken(interactive);
      await saveAuthState({ authMethod: 'getAuthToken', accessToken: '', expiresAt: 0 });
      return { token, authMethod: 'getAuthToken' };
    } catch (err) {
      if (err?.code === 'USER_CANCELLED') {
        throw err;
      }
      // If background non-interactive check failed and no fallback web client is ready, signal AUTH_REQUIRED
      if (!interactive && hasValidWebToken) {
        return { token: cachedAuth.accessToken, authMethod: 'webAuthFlow' };
      }
      if (!isValidClientId(webClientId)) {
        throw createAuthError(interactive ? 'AUTH_FAILED' : 'AUTH_REQUIRED', err?.message);
      }
      // Automatic fallback to launchWebAuthFlow (e.g., Chromium browsers without Chrome Sign-In sync)
    }
  }

  if (hasValidWebToken) {
    return { token: cachedAuth.accessToken, authMethod: 'webAuthFlow' };
  }

  if (!isValidClientId(webClientId)) {
    throw createAuthError(
      'CLIENT_ID_NOT_CONFIGURED',
      'A valid Web OAuth Client ID is required for launchWebAuthFlow in this browser.'
    );
  }

  if (!interactive) {
    // Do not open silent auth popup unless user already started a session before; return AUTH_REQUIRED cleanly
    if (!cachedAuth?.authMethod) {
      throw createAuthError('AUTH_REQUIRED', 'Sign-in required.');
    }
  }

  const { token, expiresAt } = await runWebAuthFlow({
    interactive,
    clientId: webClientId,
    scopes
  });

  await saveAuthState({
    accessToken: token,
    expiresAt,
    authMethod: 'webAuthFlow'
  });

  return { token, authMethod: 'webAuthFlow' };
}

/**
 * Invalidate a cached or expired OAuth token (used after HTTP 401 responses).
 * @param {string} token
 */
export async function invalidateToken(token) {
  if (token && typeof chrome.identity?.removeCachedAuthToken === 'function') {
    await new Promise((resolve) => {
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
  }
  const auth = await getAuthState();
  if (auth) {
    await saveAuthState({ accessToken: '', expiresAt: 0 });
  }
}

/**
 * Revoke the active OAuth token with Google and wipe all local & session user data.
 */
export async function signOut() {
  let tokenToRevoke = '';
  try {
    const cached = await getAuthState();
    tokenToRevoke = cached?.accessToken || '';
    if (!tokenToRevoke && typeof chrome.identity?.getAuthToken === 'function' && !isEdgeBrowser() && isManifestClientIdConfigured()) {
      tokenToRevoke = await getChromeIdentityToken(false).catch(() => '');
    }
  } catch {
    tokenToRevoke = '';
  }

  if (tokenToRevoke) {
    // Use no-cors form POST to keep host_permissions strictly limited to gmail.googleapis.com
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: tokenToRevoke })
      });
    } catch {
      // Best-effort revocation even if offline
    }

    if (typeof chrome.identity?.removeCachedAuthToken === 'function') {
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token: tokenToRevoke }, () => resolve());
      });
    }
  }

  if (typeof chrome.identity?.clearAllCachedAuthTokens === 'function') {
    await new Promise((resolve) => {
      chrome.identity.clearAllCachedAuthTokens(() => resolve());
    });
  }

  await clearAllUserData();
}
