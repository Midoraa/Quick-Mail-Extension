import { getAuthToken, invalidateToken } from './auth.js';
import {
  buildRawEmailMessage,
  buildRawReplyMessage,
  decodeHtmlEntitiesPlain,
  extractMimeBodies,
  formatRecipientsSummary,
  getHeader,
  parseEmailAddress
} from './utils.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const METADATA_HEADERS = ['From', 'To', 'Subject', 'Date', 'Message-ID', 'Reply-To'];

/**
 * Execute an authenticated request directly against Gmail REST API v1.
 * Automatically retries once if a cached token returns HTTP 401.
 */
async function gmailFetch(path, fetchOptions = {}, { interactive = false, retryOn401 = true } = {}) {
  const { token } = await getAuthToken({ interactive });
  const headers = new Headers(fetchOptions.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (fetchOptions.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...fetchOptions,
    headers
  });

  if (response.status === 401 && retryOn401) {
    await invalidateToken(token);
    return gmailFetch(path, fetchOptions, { interactive: false, retryOn401: false });
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || detail;
    } catch {
      // Ignore parse failures on non-JSON errors
    }
    const err = new Error(detail);
    err.status = response.status;
    throw err;
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

function normalizeMessageSummary(raw) {
  const headers = raw?.payload?.headers || [];
  const labelIds = Array.isArray(raw?.labelIds) ? raw.labelIds : [];
  const { name, email } = parseEmailAddress(getHeader(headers, 'From'));
  const toRaw = getHeader(headers, 'To');
  const subject = getHeader(headers, 'Subject') || '(no subject)';
  const timestamp = Number(raw?.internalDate) || Date.parse(getHeader(headers, 'Date')) || Date.now();

  return {
    id: raw.id,
    threadId: raw.threadId,
    labelIds,
    isUnread: labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    isDraft: labelIds.includes('DRAFT'),
    fromName: name,
    fromEmail: email,
    fromRaw: getHeader(headers, 'From'),
    toRaw,
    toDisplay: formatRecipientsSummary(toRaw),
    replyTo: getHeader(headers, 'Reply-To'),
    messageIdHeader: getHeader(headers, 'Message-ID'),
    subject,
    snippet: decodeHtmlEntitiesPlain(raw?.snippet || ''),
    timestamp
  };
}

/**
 * Fetch the signed-in user's Gmail profile (`{ emailAddress, messagesTotal, threadsTotal }`).
 * @param {{ interactive?: boolean }} [options]
 */
export async function getProfile({ interactive = false } = {}) {
  return gmailFetch('/profile', { method: 'GET' }, { interactive });
}

/**
 * Fetch exact unread message count for INBOX via `GET /labels/INBOX`.
 * Strictly counts INBOX unread only (never includes SPAM or TRASH).
 * @param {{ interactive?: boolean }} [options]
 * @returns {Promise<number>}
 */
export async function getInboxUnreadCount({ interactive = false } = {}) {
  const data = await gmailFetch('/labels/INBOX', { method: 'GET' }, { interactive });
  return Math.max(0, Number(data?.messagesUnread || 0));
}

/**
 * Fetch unread/total badge counts for Navigation Drawer labels within `gmail.modify`.
 * @param {{ interactive?: boolean }} [options]
 * @returns {Promise<{ inboxUnread: number, starredTotal: number, draftTotal: number, spamUnread: number }>}
 */
export async function getFolderCounts({ interactive = false } = {}) {
  const [inboxRes, starredRes, draftRes, spamRes] = await Promise.allSettled([
    gmailFetch('/labels/INBOX', { method: 'GET' }, { interactive }),
    gmailFetch('/labels/STARRED', { method: 'GET' }, { interactive }),
    gmailFetch('/labels/DRAFT', { method: 'GET' }, { interactive }),
    gmailFetch('/labels/SPAM', { method: 'GET' }, { interactive })
  ]);

  return {
    inboxUnread: inboxRes.status === 'fulfilled' ? Math.max(0, Number(inboxRes.value?.messagesUnread || 0)) : 0,
    starredTotal: starredRes.status === 'fulfilled' ? Math.max(0, Number(starredRes.value?.messagesTotal || 0)) : 0,
    draftTotal: draftRes.status === 'fulfilled' ? Math.max(0, Number(draftRes.value?.messagesTotal || 0)) : 0,
    spamUnread: spamRes.status === 'fulfilled' ? Math.max(0, Number(spamRes.value?.messagesUnread || 0)) : 0
  };
}

/**
 * Fetch drafts list via `GET /drafts` + metadata per draft.
 * @param {{ query?: string, maxResults?: number, interactive?: boolean }} [options]
 */
export async function listDrafts({ query = '', maxResults = 15, interactive = false } = {}) {
  const params = new URLSearchParams();
  params.set('maxResults', String(maxResults));
  const trimmedQuery = String(query || '').trim();
  if (trimmedQuery) {
    params.set('q', trimmedQuery);
  }

  const listData = await gmailFetch(`/drafts?${params.toString()}`, { method: 'GET' }, { interactive });
  const stubs = Array.isArray(listData?.drafts) ? listData.drafts : [];
  if (stubs.length === 0) return [];

  const results = [];
  for (let i = 0; i < stubs.length; i += 5) {
    const batch = stubs.slice(i, i + 5);
    const items = await Promise.all(
      batch.map((stub) =>
        gmailFetch(`/drafts/${encodeURIComponent(stub.id)}?format=metadata`, { method: 'GET' }, { interactive: false })
      )
    );
    for (const draft of items) {
      const msg = draft?.message || {};
      const summary = normalizeMessageSummary({
        ...msg,
        id: msg.id || draft.id,
        threadId: msg.threadId || ''
      });
      results.push({
        ...summary,
        draftId: draft.id,
        isDraft: true,
        isUnread: false
      });
    }
  }

  return results;
}

/**
 * Fetch newest messages for any folder (`INBOX`, `STARRED`, `SENT`, `DRAFT`, `SPAM`, `TRASH`).
 * Automatically passes `includeSpamTrash=true` when querying `SPAM` or `TRASH`.
 * @param {{ folder?: string, filter?: 'all' | 'unread', query?: string, maxResults?: number, interactive?: boolean }} [options]
 */
export async function listFolderMessages({
  folder = 'INBOX',
  filter = 'all',
  query = '',
  maxResults = 15,
  interactive = false
} = {}) {
  const targetFolder = String(folder || 'INBOX').toUpperCase();
  if (targetFolder === 'DRAFT') {
    return listDrafts({ query, maxResults, interactive });
  }

  const params = new URLSearchParams();
  params.set('maxResults', String(maxResults));
  params.append('labelIds', targetFolder);

  if (filter === 'unread' && targetFolder !== 'SENT') {
    params.append('labelIds', 'UNREAD');
  }
  if (targetFolder === 'SPAM' || targetFolder === 'TRASH') {
    params.set('includeSpamTrash', 'true');
  }

  const trimmedQuery = String(query || '').trim();
  if (trimmedQuery) {
    params.set('q', trimmedQuery);
  }

  const listData = await gmailFetch(`/messages?${params.toString()}`, { method: 'GET' }, { interactive });
  const stubs = Array.isArray(listData?.messages) ? listData.messages : [];
  if (stubs.length === 0) return [];

  const metadataParams = new URLSearchParams({ format: 'metadata' });
  for (const h of METADATA_HEADERS) {
    metadataParams.append('metadataHeaders', h);
  }
  const metadataQuery = metadataParams.toString();

  // Fetch metadata in small parallel batches of 5 to keep UI snappy and respect rate limits
  const results = [];
  for (let i = 0; i < stubs.length; i += 5) {
    const batch = stubs.slice(i, i + 5);
    const items = await Promise.all(
      batch.map((stub) =>
        gmailFetch(`/messages/${encodeURIComponent(stub.id)}?${metadataQuery}`, { method: 'GET' }, { interactive: false })
      )
    );
    results.push(...items.map(normalizeMessageSummary));
  }

  return results;
}

/**
 * Fetch the newest inbox messages (wrapper around `listFolderMessages` for `background.js`).
 */
export async function listInboxMessages(options = {}) {
  return listFolderMessages({ ...options, folder: 'INBOX' });
}

/**
 * Fetch full email detail including MIME body (`textPlain`, `textHtml`) and reply threading headers.
 * @param {string} messageId
 */
export async function getMessageDetail(messageId) {
  const raw = await gmailFetch(`/messages/${encodeURIComponent(messageId)}?format=full`, { method: 'GET' });
  const summary = normalizeMessageSummary(raw);
  const headers = raw?.payload?.headers || [];
  const { textPlain, textHtml } = extractMimeBodies(raw?.payload);

  return {
    ...summary,
    to: getHeader(headers, 'To'),
    references: getHeader(headers, 'References'),
    textPlain,
    textHtml
  };
}

/**
 * Fetch full draft detail via `GET /drafts/{draftId}?format=full`.
 * @param {string} draftId
 */
export async function getDraftDetail(draftId) {
  const draft = await gmailFetch(`/drafts/${encodeURIComponent(draftId)}?format=full`, { method: 'GET' });
  const msg = draft?.message || {};
  const headers = msg?.payload?.headers || [];
  const { textPlain, textHtml } = extractMimeBodies(msg?.payload);

  return {
    id: msg.id || draft.id,
    draftId: draft.id,
    threadId: msg.threadId || '',
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject'),
    inReplyTo: getHeader(headers, 'In-Reply-To'),
    references: getHeader(headers, 'References'),
    snippet: decodeHtmlEntitiesPlain(msg?.snippet || ''),
    timestamp: Number(msg?.internalDate) || Date.now(),
    textPlain,
    textHtml
  };
}

/**
 * Update an existing draft via `PUT /drafts/{draftId}`.
 */
export async function updateDraft({
  draftId,
  to = '',
  subject = '',
  body = '',
  threadId = '',
  inReplyTo = '',
  references = ''
}) {
  const raw = buildRawEmailMessage({ to, subject, body, inReplyTo, references });
  const messagePayload = threadId ? { raw, threadId } : { raw };
  return gmailFetch(`/drafts/${encodeURIComponent(draftId)}`, {
    method: 'PUT',
    body: JSON.stringify({ id: draftId, message: messagePayload })
  });
}

/**
 * Send an existing draft via `POST /drafts/send`.
 */
export async function sendDraft({
  draftId,
  to = '',
  subject = '',
  body = '',
  threadId = '',
  inReplyTo = '',
  references = ''
}) {
  const raw = buildRawEmailMessage({ to, subject, body, inReplyTo, references });
  const messagePayload = threadId ? { raw, threadId } : { raw };
  return gmailFetch('/drafts/send', {
    method: 'POST',
    body: JSON.stringify({ id: draftId, message: messagePayload })
  });
}

/**
 * Discard/delete a draft via `DELETE /drafts/{draftId}` (permitted under `gmail.modify`).
 * @param {string} draftId
 */
export async function deleteDraft(draftId) {
  return gmailFetch(`/drafts/${encodeURIComponent(draftId)}`, {
    method: 'DELETE'
  });
}

/**
 * Mark an email as read by removing the `UNREAD` label.
 * @param {string} messageId
 */
export async function markAsRead(messageId) {
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
  });
}

/**
 * Mark an email as unread by adding the `UNREAD` label.
 * @param {string} messageId
 */
export async function markAsUnread(messageId) {
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: ['UNREAD'] })
  });
}

/**
 * Add or remove the `STARRED` label on a message.
 * @param {string} messageId
 * @param {boolean} starred
 */
export async function setMessageStarred(messageId, starred) {
  const body = starred
    ? { addLabelIds: ['STARRED'] }
    : { removeLabelIds: ['STARRED'] };
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * Archive an email by removing it from `INBOX`.
 * @param {string} messageId
 */
export async function archiveMessage(messageId) {
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['INBOX'] })
  });
}

/**
 * Move an email out of Spam back into Inbox (`remove SPAM`, `add INBOX`).
 * @param {string} messageId
 */
export async function markNotSpam(messageId) {
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['SPAM'], addLabelIds: ['INBOX'] })
  });
}

/**
 * Restore a trashed email back into Inbox (`remove TRASH`, `add INBOX`).
 * @param {string} messageId
 */
export async function restoreFromTrash(messageId) {
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['TRASH'], addLabelIds: ['INBOX'] })
  });
}

/**
 * Move an email to Trash.
 * @param {string} messageId
 */
export async function trashMessage(messageId) {
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/trash`, {
    method: 'POST'
  });
}

/**
 * Send a quick reply within the same Gmail thread using proper `In-Reply-To` and `References` headers.
 * @param {{ to: string, subject: string, body: string, threadId: string, inReplyTo?: string, references?: string }} params
 */
export async function sendQuickReply({ to, subject, body, threadId, inReplyTo = '', references = '' }) {
  const raw = buildRawReplyMessage({ to, subject, body, inReplyTo, references });
  return gmailFetch('/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw, threadId })
  });
}
