export const DEFAULT_SETTINGS = Object.freeze({
  pollIntervalMinutes: 1,
  notificationsEnabled: true,
  webClientId: ''
});

export const VALID_POLL_INTERVALS = Object.freeze([1, 3, 5]);
export const VALID_FOLDERS = Object.freeze(['INBOX', 'STARRED', 'SENT', 'DRAFT', 'SPAM', 'TRASH']);

const KEYS = Object.freeze({
  SETTINGS: 'quickmail_settings',
  AUTH: 'quickmail_auth',
  SYNC: 'quickmail_sync',
  LAST_FOLDER: 'quickmail_last_folder',
  ACTIVE_VIEW: 'quickmail_active_view',
  DRAFT_PREFIX: 'quickmail_draft_'
});

/**
 * Normalize a folder ID against supported Gmail labels.
 * @param {string} folder
 * @returns {'INBOX'|'STARRED'|'SENT'|'DRAFT'|'SPAM'|'TRASH'}
 */
export function normalizeFolder(folder) {
  const upper = String(folder || '').toUpperCase();
  return VALID_FOLDERS.includes(upper) ? upper : 'INBOX';
}

/**
 * Return `chrome.storage.session` when available, falling back to `chrome.storage.local`.
 * @returns {chrome.storage.StorageArea}
 */
export function getSessionStorage() {
  return chrome.storage?.session || chrome.storage.local;
}

/**
 * Normalize poll interval to one of [1, 3, 5].
 * @param {number} value
 * @returns {number}
 */
export function normalizePollInterval(value) {
  const num = Number(value);
  return VALID_POLL_INTERVALS.includes(num) ? num : DEFAULT_SETTINGS.pollIntervalMinutes;
}

/**
 * Read user extension settings from `chrome.storage.local`.
 * @returns {Promise<{ pollIntervalMinutes: number, notificationsEnabled: boolean, webClientId: string }>}
 */
export async function getSettings() {
  const data = await chrome.storage.local.get(KEYS.SETTINGS);
  const stored = data?.[KEYS.SETTINGS] || {};
  return {
    pollIntervalMinutes: normalizePollInterval(stored.pollIntervalMinutes),
    notificationsEnabled: typeof stored.notificationsEnabled === 'boolean'
      ? stored.notificationsEnabled
      : DEFAULT_SETTINGS.notificationsEnabled,
    webClientId: typeof stored.webClientId === 'string' ? stored.webClientId.trim() : ''
  };
}

/**
 * Merge and save settings into `chrome.storage.local`.
 * @param {Partial<{ pollIntervalMinutes: number, notificationsEnabled: boolean, webClientId: string }>} partial
 */
export async function saveSettings(partial) {
  const current = await getSettings();
  const next = {
    ...current,
    ...partial,
    pollIntervalMinutes: normalizePollInterval(
      partial.pollIntervalMinutes ?? current.pollIntervalMinutes
    ),
    webClientId: typeof (partial.webClientId ?? current.webClientId) === 'string'
      ? (partial.webClientId ?? current.webClientId).trim()
      : ''
  };
  await chrome.storage.local.set({ [KEYS.SETTINGS]: next });
  return next;
}

/**
 * Read auth cache (`{ accessToken, expiresAt, authMethod, userEmail }`).
 */
export async function getAuthState() {
  const data = await chrome.storage.local.get(KEYS.AUTH);
  return data?.[KEYS.AUTH] || null;
}

/**
 * Merge and persist auth state to `chrome.storage.local`.
 * @param {object} partial
 */
export async function saveAuthState(partial) {
  const current = (await getAuthState()) || {};
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [KEYS.AUTH]: next });
  return next;
}

/**
 * Read sync metadata (`{ lastKnownUnreadCount, lastSyncAt }`).
 */
export async function getSyncState() {
  const data = await chrome.storage.local.get(KEYS.SYNC);
  return data?.[KEYS.SYNC] || { lastKnownUnreadCount: null, lastSyncAt: 0 };
}

/**
 * Merge and persist sync metadata.
 * @param {object} partial
 */
export async function saveSyncState(partial) {
  const current = await getSyncState();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [KEYS.SYNC]: next });
  return next;
}

/**
 * Read a quick reply draft from `chrome.storage.session`.
 * @param {string} key
 * @returns {Promise<string>}
 */
export async function getDraft(key) {
  if (!key) return '';
  const storageKey = `${KEYS.DRAFT_PREFIX}${key}`;
  const session = getSessionStorage();
  const data = await session.get(storageKey);
  return typeof data?.[storageKey] === 'string' ? data[storageKey] : '';
}

/**
 * Save or clear a quick reply draft in `chrome.storage.session`.
 * @param {string} key
 * @param {string} text
 */
export async function saveDraft(key, text) {
  if (!key) return;
  const storageKey = `${KEYS.DRAFT_PREFIX}${key}`;
  const session = getSessionStorage();
  if (!text) {
    await session.remove(storageKey);
    return;
  }
  await session.set({ [storageKey]: text });
}

/**
 * Delete a quick reply draft from `chrome.storage.session`.
 * @param {string} key
 */
export async function clearDraft(key) {
  if (!key) return;
  const session = getSessionStorage();
  await session.remove(`${KEYS.DRAFT_PREFIX}${key}`);
}

/**
 * Read the last opened folder ID from `chrome.storage.local`.
 * @returns {Promise<'INBOX'|'STARRED'|'SENT'|'DRAFT'|'SPAM'|'TRASH'>}
 */
export async function getLastFolder() {
  const data = await chrome.storage.local.get(KEYS.LAST_FOLDER);
  return normalizeFolder(data?.[KEYS.LAST_FOLDER]);
}

/**
 * Persist the last opened folder ID to `chrome.storage.local`.
 * @param {string} folder
 */
export async function saveLastFolder(folder) {
  const normalized = normalizeFolder(folder);
  await chrome.storage.local.set({ [KEYS.LAST_FOLDER]: normalized });
  return normalized;
}

/**
 * Read the last active view state (allows seamless handoff from Popup to Side Panel).
 */
export async function getActiveViewState() {
  const session = getSessionStorage();
  const data = await session.get(KEYS.ACTIVE_VIEW);
  return data?.[KEYS.ACTIVE_VIEW] || null;
}

/**
 * Save the active view state (`{ view, folder, messageId, draftId, filter, query }`).
 * @param {object} state
 */
export async function saveActiveViewState(state) {
  const session = getSessionStorage();
  await session.set({ [KEYS.ACTIVE_VIEW]: state });
}

/**
 * Clear saved active view state.
 */
export async function clearActiveViewState() {
  const session = getSessionStorage();
  await session.remove(KEYS.ACTIVE_VIEW);
}

/**
 * Remove all cached user auth data, sync counters, drafts, and session view state.
 */
export async function clearAllUserData() {
  await chrome.storage.local.remove([KEYS.AUTH, KEYS.SYNC, KEYS.LAST_FOLDER]);

  const session = getSessionStorage();
  const allSession = await session.get(null);
  const sessionKeysToRemove = Object.keys(allSession || {}).filter(
    (k) => k === KEYS.ACTIVE_VIEW || k.startsWith(KEYS.DRAFT_PREFIX)
  );
  if (sessionKeysToRemove.length > 0) {
    await session.remove(sessionKeysToRemove);
  }
}
