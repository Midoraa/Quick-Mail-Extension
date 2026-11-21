import { isClientIdConfigured } from './js/auth.js';
import { getInboxUnreadCount, listInboxMessages } from './js/gmail-api.js';
import {
  getSettings,
  getSyncState,
  normalizePollInterval,
  saveSyncState
} from './js/storage.js';

const POLL_ALARM_NAME = 'quickmail-poll';
const BADGE_BG_COLOR = '#EA4335';
const BADGE_TEXT_COLOR = '#FFFFFF';
const GMAIL_INBOX_URL = 'https://mail.google.com/mail/u/0/#inbox';

/**
 * Update toolbar extension badge text and colors.
 * Shows 1-99, `99+` above 99, or clears badge when 0.
 * @param {number} unreadCount
 */
async function updateBadge(unreadCount) {
  const count = Math.max(0, Number(unreadCount) || 0);
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_BG_COLOR });
  if (typeof chrome.action.setBadgeTextColor === 'function') {
    await chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
  }
  const text = count === 0 ? '' : count > 99 ? '99+' : String(count);
  await chrome.action.setBadgeText({ text });
}

/**
 * Ensure the periodic polling alarm exists with the user's configured interval.
 * @param {number} [overrideMinutes]
 */
async function ensurePollAlarm(overrideMinutes) {
  const settings = await getSettings();
  const periodInMinutes = normalizePollInterval(overrideMinutes ?? settings.pollIntervalMinutes);
  await chrome.alarms.clear(POLL_ALARM_NAME);
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes });
  return periodInMinutes;
}

/**
 * Send a concise desktop notification when unread count increases.
 * @param {number} count
 * @param {number} delta
 */
async function notifyNewUnread(count, delta) {
  let message = `You have ${delta} new unread email${delta > 1 ? 's' : ''} (${count} unread total).`;

  try {
    const latest = await listInboxMessages({ filter: 'unread', maxResults: 1, interactive: false });
    if (latest.length > 0 && delta === 1) {
      const mail = latest[0];
      message = `${mail.fromName}: ${mail.subject}`;
    } else if (latest.length > 0 && delta > 1) {
      const mail = latest[0];
      message = `Latest from ${mail.fromName}: ${mail.subject} (+${delta - 1} more)`;
    }
  } catch {
    // Keep generic fallback message if metadata fetch fails
  }

  chrome.notifications.create(`quickmail-unread-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Quick Mail — New email',
    message
  });
}

/**
 * Poll Inbox unread count, update badge, and trigger notifications when unread count rises.
 * @param {{ triggerNotification?: boolean }} [options]
 */
async function syncUnreadCount({ triggerNotification = true } = {}) {
  const configured = await isClientIdConfigured();
  if (!configured) {
    await updateBadge(0);
    return { ok: false, unreadCount: 0, configured: false };
  }

  let count;
  try {
    count = await getInboxUnreadCount({ interactive: false });
  } catch (err) {
    if (err?.code === 'AUTH_REQUIRED' || err?.code === 'CLIENT_ID_NOT_CONFIGURED') {
      await updateBadge(0);
      return { ok: false, unreadCount: 0, authRequired: true };
    }
    return { ok: false, error: err?.message || 'Sync failed' };
  }

  await updateBadge(count);

  const [syncState, settings] = await Promise.all([getSyncState(), getSettings()]);
  const prev = syncState.lastKnownUnreadCount;

  if (
    triggerNotification &&
    settings.notificationsEnabled &&
    typeof prev === 'number' &&
    count > prev
  ) {
    await notifyNewUnread(count, count - prev);
  }

  await saveSyncState({ lastKnownUnreadCount: count, lastSyncAt: Date.now() });
  return { ok: true, unreadCount: count };
}

chrome.runtime.onInstalled.addListener(() => {
  ensurePollAlarm()
    .then(() => syncUnreadCount({ triggerNotification: false }))
    .catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensurePollAlarm()
    .then(() => syncUnreadCount({ triggerNotification: false }))
    .catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === POLL_ALARM_NAME) {
    syncUnreadCount({ triggerNotification: true }).catch(() => {});
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  chrome.tabs.create({ url: GMAIL_INBOX_URL });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  if (message.type === 'SYNC_BADGE') {
    syncUnreadCount({ triggerNotification: false })
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err?.message }));
    return true;
  }

  if (message.type === 'SET_BADGE_COUNT') {
    const count = Math.max(0, Number(message.count) || 0);
    Promise.all([
      updateBadge(count),
      saveSyncState({ lastKnownUnreadCount: count, lastSyncAt: Date.now() })
    ])
      .then(() => sendResponse({ ok: true, unreadCount: count }))
      .catch((err) => sendResponse({ ok: false, error: err?.message }));
    return true;
  }

  if (message.type === 'UPDATE_POLL_INTERVAL') {
    ensurePollAlarm(message.minutes)
      .then((periodInMinutes) => sendResponse({ ok: true, periodInMinutes }))
      .catch((err) => sendResponse({ ok: false, error: err?.message }));
    return true;
  }

  if (message.type === 'CLEAR_BADGE') {
    updateBadge(0)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message }));
    return true;
  }

  return false;
});
