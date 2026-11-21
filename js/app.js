import { getPrivacyPolicyUrl } from './config.js';
import {
  getAuthToken,
  getRedirectUrl,
  isClientIdConfigured,
  isEdgeBrowser,
  isManifestClientIdConfigured,
  isValidClientId,
  signOut
} from './auth.js';
import {
  archiveMessage,
  deleteDraft,
  getDraftDetail,
  getFolderCounts,
  getMessageDetail,
  getProfile,
  listFolderMessages,
  markAsRead,
  markAsUnread,
  markNotSpam,
  restoreFromTrash,
  sendDraft,
  sendQuickReply,
  setMessageStarred,
  trashMessage,
  updateDraft
} from './gmail-api.js';
import { renderPlainTextToFragment, sanitizeHtmlToFragment } from './sanitize.js';
import {
  clearActiveViewState,
  clearDraft,
  getActiveViewState,
  getAuthState,
  getDraft,
  getLastFolder,
  getSettings,
  normalizeFolder,
  saveActiveViewState,
  saveAuthState,
  saveDraft,
  saveLastFolder,
  saveSettings
} from './storage.js';
import { formatFullDate, formatRelativeTime, getInitials } from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GMAIL_WEB_BASE = 'https://mail.google.com/mail/u/0/';

const FOLDERS = Object.freeze({
  INBOX: {
    label: 'Inbox',
    gmailHash: '#inbox',
    showUnreadFilter: true,
    notice: ''
  },
  STARRED: {
    label: 'Starred',
    gmailHash: '#starred',
    showUnreadFilter: true,
    notice: ''
  },
  SENT: {
    label: 'Sent',
    gmailHash: '#sent',
    showUnreadFilter: false,
    notice: ''
  },
  DRAFT: {
    label: 'Drafts',
    gmailHash: '#drafts',
    showUnreadFilter: false,
    notice: ''
  },
  SPAM: {
    label: 'Spam',
    gmailHash: '#spam',
    showUnreadFilter: true,
    notice: 'Messages in Spam are excluded from your toolbar unread badge. Click "Not spam" to move a message back to Inbox.'
  },
  TRASH: {
    label: 'Trash',
    gmailHash: '#trash',
    showUnreadFilter: true,
    notice: 'Messages in Trash are excluded from your toolbar unread badge. Click "Restore to Inbox" to recover a message.'
  }
});

const els = {
  btnMenu: document.getElementById('btnMenu'),
  headerTitle: document.getElementById('headerTitle'),
  unreadBadge: document.getElementById('unreadBadge'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnOpenSidePanel: document.getElementById('btnOpenSidePanel'),
  btnSettings: document.getElementById('btnSettings'),

  navBackdrop: document.getElementById('navBackdrop'),
  navDrawer: document.getElementById('navDrawer'),
  drawerAccount: document.getElementById('drawerAccount'),
  btnCloseDrawer: document.getElementById('btnCloseDrawer'),
  drawerItems: Array.from(document.querySelectorAll('.drawer-item[data-folder]')),
  countInbox: document.getElementById('countInbox'),
  countStarred: document.getElementById('countStarred'),
  countDraft: document.getElementById('countDraft'),
  countSpam: document.getElementById('countSpam'),

  viewWelcome: document.getElementById('viewWelcome'),
  setupBanner: document.getElementById('setupBanner'),
  welcomeError: document.getElementById('welcomeError'),
  btnSignIn: document.getElementById('btnSignIn'),
  linkWelcomePrivacy: document.getElementById('linkWelcomePrivacy'),
  linkDrawerPrivacy: document.getElementById('linkDrawerPrivacy'),
  linkSettingsPrivacy: document.getElementById('linkSettingsPrivacy'),

  viewInbox: document.getElementById('viewInbox'),
  searchInput: document.getElementById('searchInput'),
  btnClearSearch: document.getElementById('btnClearSearch'),
  filterTabs: document.getElementById('filterTabs'),
  filterAll: document.getElementById('filterAll'),
  filterUnread: document.getElementById('filterUnread'),
  folderNoticeBanner: document.getElementById('folderNoticeBanner'),
  inboxError: document.getElementById('inboxError'),
  inboxErrorText: document.getElementById('inboxErrorText'),
  btnRetryInbox: document.getElementById('btnRetryInbox'),
  inboxLoading: document.getElementById('inboxLoading'),
  inboxEmpty: document.getElementById('inboxEmpty'),
  inboxList: document.getElementById('inboxList'),

  viewDetail: document.getElementById('viewDetail'),
  btnBack: document.getElementById('btnBack'),
  btnDetailNotSpam: document.getElementById('btnDetailNotSpam'),
  btnDetailRestore: document.getElementById('btnDetailRestore'),
  btnDetailStar: document.getElementById('btnDetailStar'),
  btnDetailToggleRead: document.getElementById('btnDetailToggleRead'),
  btnDetailArchive: document.getElementById('btnDetailArchive'),
  btnDetailTrash: document.getElementById('btnDetailTrash'),
  btnOpenInGmail: document.getElementById('btnOpenInGmail'),
  detailScroll: document.getElementById('detailScroll'),
  detailSubject: document.getElementById('detailSubject'),
  detailAvatar: document.getElementById('detailAvatar'),
  detailSenderName: document.getElementById('detailSenderName'),
  detailDate: document.getElementById('detailDate'),
  detailSenderEmail: document.getElementById('detailSenderEmail'),
  detailRecipient: document.getElementById('detailRecipient'),
  detailBodyModeWrap: document.getElementById('detailBodyModeWrap'),
  detailBodyModeLabel: document.getElementById('detailBodyModeLabel'),
  btnToggleBodyMode: document.getElementById('btnToggleBodyMode'),
  detailBody: document.getElementById('detailBody'),
  detailReplies: document.getElementById('detailReplies'),
  quickReplyForm: document.getElementById('quickReplyForm'),
  replyToLabel: document.getElementById('replyToLabel'),
  draftIndicator: document.getElementById('draftIndicator'),
  quickReplyInput: document.getElementById('quickReplyInput'),
  btnSendReply: document.getElementById('btnSendReply'),

  viewDraft: document.getElementById('viewDraft'),
  btnDraftBack: document.getElementById('btnDraftBack'),
  btnDraftDelete: document.getElementById('btnDraftDelete'),
  btnDraftSave: document.getElementById('btnDraftSave'),
  btnDraftSend: document.getElementById('btnDraftSend'),
  draftToInput: document.getElementById('draftToInput'),
  draftSubjectInput: document.getElementById('draftSubjectInput'),
  draftEditorStatus: document.getElementById('draftEditorStatus'),
  draftBodyInput: document.getElementById('draftBodyInput'),

  viewSettings: document.getElementById('viewSettings'),
  btnSettingsBack: document.getElementById('btnSettingsBack'),
  settingsAccountValue: document.getElementById('settingsAccountValue'),
  settingsAuthMethod: document.getElementById('settingsAuthMethod'),
  settingsPollInterval: document.getElementById('settingsPollInterval'),
  settingsNotifications: document.getElementById('settingsNotifications'),
  settingsRedirectUrl: document.getElementById('settingsRedirectUrl'),
  btnCopyRedirectUrl: document.getElementById('btnCopyRedirectUrl'),
  settingsWebClientId: document.getElementById('settingsWebClientId'),
  btnSaveWebClientId: document.getElementById('btnSaveWebClientId'),
  btnSignOut: document.getElementById('btnSignOut'),

  toast: document.getElementById('toast')
};

const state = {
  windowId: null,
  isAuthenticated: false,
  userEmail: '',
  folder: 'INBOX',
  currentView: 'welcome',
  previousViewBeforeSettings: 'welcome',
  filter: 'all',
  query: '',
  messages: [],
  unreadCount: 0,
  folderCounts: {
    inboxUnread: 0,
    starredTotal: 0,
    draftTotal: 0,
    spamUnread: 0
  },
  selectedMessage: null,
  selectedDraft: null,
  bodyRenderMode: 'plain',
  sessionSentReplies: new Map(),
  searchDebounceTimer: null,
  draftDebounceTimer: null,
  editorDraftDebounceTimer: null,
  toastTimer: null
};

function sendBackgroundMessage(payload) {
  try {
    return chrome.runtime.sendMessage(payload).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

function showToast(message, durationMs = 2600) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, durationMs);
}

function createSvgIcon(shapes) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    svg.appendChild(el);
  }
  return svg;
}

function getStarIconShapes() {
  return [[
    'polygon',
    { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' }
  ]];
}

function getMailIconShapes(isUnread) {
  if (isUnread) {
    return [
      ['path', { d: 'M21 10.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9' }],
      ['polyline', { points: '3 7 11 12 16 9' }],
      ['polyline', { points: '16 5 18.5 7.5 22 4' }]
    ];
  }
  return [
    ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }],
    ['polyline', { points: '3 7 12 13 21 7' }]
  ];
}

function getArchiveIconShapes() {
  return [
    ['rect', { x: '3', y: '4', width: '18', height: '4', rx: '1' }],
    ['path', { d: 'M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8' }],
    ['line', { x1: '10', y1: '12', x2: '14', y2: '12' }]
  ];
}

function getTrashIconShapes() {
  return [
    ['polyline', { points: '3 6 5 6 21 6' }],
    ['path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }],
    ['path', { d: 'M10 11v6M14 11v6' }]
  ];
}

function getRestoreIconShapes() {
  return [
    ['polyline', { points: '9 14 4 9 9 4' }],
    ['path', { d: 'M20 20v-7a4 4 0 0 0-4-4H4' }]
  ];
}

function isInboxActiveMessage(msg) {
  const labels = Array.isArray(msg?.labelIds) ? msg.labelIds : [];
  return labels.includes('INBOX') && !labels.includes('SPAM') && !labels.includes('TRASH');
}

function formatBadgeCount(num) {
  if (num <= 0) return '';
  return num > 99 ? '99+' : String(num);
}

/**
 * Update the toolbar badge & header unread counter using Inbox unread count only.
 */
function updateUnreadIndicators(inboxUnread) {
  const safeCount = Math.max(0, Number(inboxUnread) || 0);
  state.unreadCount = safeCount;
  state.folderCounts.inboxUnread = safeCount;

  if (safeCount > 0 && state.isAuthenticated) {
    els.unreadBadge.textContent = formatBadgeCount(safeCount);
    els.unreadBadge.hidden = false;
  } else {
    els.unreadBadge.hidden = true;
  }

  renderDrawerCounts();
  sendBackgroundMessage({ type: 'SET_BADGE_COUNT', count: state.isAuthenticated ? safeCount : 0 });
}

function renderDrawerCounts() {
  const { inboxUnread, starredTotal, draftTotal, spamUnread } = state.folderCounts;

  const setPill = (el, val) => {
    if (!el) return;
    if (val > 0) {
      el.textContent = formatBadgeCount(val);
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  };

  setPill(els.countInbox, inboxUnread);
  setPill(els.countStarred, starredTotal);
  setPill(els.countDraft, draftTotal);
  setPill(els.countSpam, spamUnread);
}

async function refreshFolderCounts() {
  if (!state.isAuthenticated) return;
  try {
    const counts = await getFolderCounts({ interactive: false });
    state.folderCounts = counts;
    updateUnreadIndicators(counts.inboxUnread);
  } catch {
    // Keep existing counts if secondary count poll fails
  }
}

function updateHeaderAndFolderUI() {
  els.btnMenu.hidden = !state.isAuthenticated;

  if (!state.isAuthenticated || state.currentView === 'welcome') {
    els.headerTitle.textContent = 'Quick Mail';
  } else {
    els.headerTitle.textContent = FOLDERS[state.folder]?.label || 'Inbox';
  }

  els.drawerAccount.textContent = state.userEmail || 'Connected to Google';

  for (const item of els.drawerItems) {
    item.classList.toggle('is-active', item.dataset.folder === state.folder);
  }

  const meta = FOLDERS[state.folder] || FOLDERS.INBOX;
  els.filterTabs.hidden = !meta.showUnreadFilter;
  if (meta.notice) {
    els.folderNoticeBanner.textContent = meta.notice;
    els.folderNoticeBanner.hidden = false;
  } else {
    els.folderNoticeBanner.hidden = true;
  }
}

function isDrawerOpen() {
  return els.navDrawer.classList.contains('is-open');
}

function openDrawer() {
  if (!state.isAuthenticated) return;
  els.navBackdrop.hidden = false;
  els.navDrawer.classList.add('is-open');
  els.navDrawer.setAttribute('aria-hidden', 'false');
  els.btnMenu.setAttribute('aria-expanded', 'true');
  refreshFolderCounts();
}

function closeDrawer() {
  els.navDrawer.classList.remove('is-open');
  els.navDrawer.setAttribute('aria-hidden', 'true');
  els.navBackdrop.hidden = true;
  els.btnMenu.setAttribute('aria-expanded', 'false');
}

function setActiveView(viewName) {
  state.currentView = viewName;
  els.viewWelcome.hidden = viewName !== 'welcome';
  els.viewInbox.hidden = viewName !== 'inbox';
  els.viewDetail.hidden = viewName !== 'detail';
  els.viewDraft.hidden = viewName !== 'draft';
  els.viewSettings.hidden = viewName !== 'settings';
  els.btnRefresh.hidden = viewName === 'welcome' || viewName === 'settings';

  updateHeaderAndFolderUI();
  persistActiveViewState().catch(() => {});
}

async function persistActiveViewState() {
  if (!state.isAuthenticated) {
    await clearActiveViewState();
    return;
  }
  await saveActiveViewState({
    view: state.currentView === 'detail' ? 'detail' : state.currentView === 'draft' ? 'draft' : 'inbox',
    folder: state.folder,
    messageId: state.currentView === 'detail' ? state.selectedMessage?.id || '' : '',
    draftId: state.currentView === 'draft' ? state.selectedDraft?.draftId || '' : '',
    filter: state.filter,
    query: state.query
  });
}

async function renderWelcomeScreen(errorMsg = '') {
  closeDrawer();
  const configured = await isClientIdConfigured();
  els.setupBanner.hidden = configured;

  if (errorMsg) {
    els.welcomeError.textContent = errorMsg;
    els.welcomeError.hidden = false;
  } else {
    els.welcomeError.hidden = true;
  }

  updateUnreadIndicators(0);
  setActiveView('welcome');
}

function setFilterUI(filter) {
  state.filter = filter;
  const isUnread = filter === 'unread';
  els.filterAll.classList.toggle('is-active', !isUnread);
  els.filterAll.setAttribute('aria-selected', String(!isUnread));
  els.filterUnread.classList.toggle('is-active', isUnread);
  els.filterUnread.setAttribute('aria-selected', String(isUnread));
}

function buildRowQuickActions(msg) {
  const actions = document.createElement('div');
  actions.className = 'row-actions';

  if (state.folder === 'DRAFT' || msg.isDraft) {
    const btnDiscard = document.createElement('button');
    btnDiscard.type = 'button';
    btnDiscard.className = 'row-action-btn is-danger';
    btnDiscard.title = 'Discard Draft';
    btnDiscard.setAttribute('aria-label', 'Discard Draft');
    btnDiscard.appendChild(createSvgIcon(getTrashIconShapes()));
    btnDiscard.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteDraft(msg.draftId, { fromList: true });
    });
    actions.appendChild(btnDiscard);
    return actions;
  }

  if (state.folder === 'SPAM') {
    const btnNotSpam = document.createElement('button');
    btnNotSpam.type = 'button';
    btnNotSpam.className = 'row-action-btn';
    btnNotSpam.title = 'Not spam';
    btnNotSpam.setAttribute('aria-label', 'Not spam');
    btnNotSpam.appendChild(createSvgIcon(getRestoreIconShapes()));
    btnNotSpam.addEventListener('click', (e) => {
      e.stopPropagation();
      handleMarkNotSpam(msg);
    });
    actions.appendChild(btnNotSpam);
  }

  if (state.folder === 'TRASH') {
    const btnRestore = document.createElement('button');
    btnRestore.type = 'button';
    btnRestore.className = 'row-action-btn';
    btnRestore.title = 'Restore to Inbox';
    btnRestore.setAttribute('aria-label', 'Restore to Inbox');
    btnRestore.appendChild(createSvgIcon(getRestoreIconShapes()));
    btnRestore.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRestoreFromTrash(msg);
    });
    actions.appendChild(btnRestore);
  }

  const btnRead = document.createElement('button');
  btnRead.type = 'button';
  btnRead.className = 'row-action-btn';
  btnRead.title = msg.isUnread ? 'Mark as read' : 'Mark as unread';
  btnRead.setAttribute('aria-label', btnRead.title);
  btnRead.appendChild(createSvgIcon(getMailIconShapes(msg.isUnread)));
  btnRead.addEventListener('click', (e) => {
    e.stopPropagation();
    handleToggleReadFromList(msg);
  });
  actions.appendChild(btnRead);

  if (state.folder === 'INBOX' || (state.folder === 'STARRED' && isInboxActiveMessage(msg))) {
    const btnArchive = document.createElement('button');
    btnArchive.type = 'button';
    btnArchive.className = 'row-action-btn';
    btnArchive.title = 'Archive';
    btnArchive.setAttribute('aria-label', 'Archive');
    btnArchive.appendChild(createSvgIcon(getArchiveIconShapes()));
    btnArchive.addEventListener('click', (e) => {
      e.stopPropagation();
      handleArchiveMessage(msg);
    });
    actions.appendChild(btnArchive);
  }

  // Never expose permanent delete inside Trash (requires broader mail.google.com scope)
  if (state.folder !== 'TRASH') {
    const btnTrash = document.createElement('button');
    btnTrash.type = 'button';
    btnTrash.className = 'row-action-btn is-danger';
    btnTrash.title = 'Move to Trash';
    btnTrash.setAttribute('aria-label', 'Move to Trash');
    btnTrash.appendChild(createSvgIcon(getTrashIconShapes()));
    btnTrash.addEventListener('click', (e) => {
      e.stopPropagation();
      handleTrashMessage(msg);
    });
    actions.appendChild(btnTrash);
  }

  return actions;
}

function renderEmailList() {
  els.inboxList.textContent = '';

  if (state.messages.length === 0) {
    els.inboxEmpty.hidden = false;
    return;
  }

  els.inboxEmpty.hidden = true;
  const fragment = document.createDocumentFragment();

  for (const msg of state.messages) {
    const li = document.createElement('li');
    li.className = `email-row${msg.isUnread && state.folder !== 'SENT' && state.folder !== 'DRAFT' ? ' is-unread' : ''}`;
    li.tabIndex = 0;
    li.dataset.id = msg.id;

    const starSlot = document.createElement('div');
    starSlot.className = 'star-slot';

    if (msg.isUnread && state.folder !== 'SENT' && state.folder !== 'DRAFT') {
      const dot = document.createElement('span');
      dot.className = 'unread-dot';
      dot.title = 'Unread';
      starSlot.appendChild(dot);
    }

    if (state.folder !== 'DRAFT' && !msg.isDraft) {
      const btnStar = document.createElement('button');
      btnStar.type = 'button';
      btnStar.className = `row-star-btn${msg.isStarred ? ' is-starred' : ''}`;
      btnStar.title = msg.isStarred ? 'Remove star' : 'Add star';
      btnStar.setAttribute('aria-label', btnStar.title);
      btnStar.appendChild(createSvgIcon(getStarIconShapes()));
      btnStar.addEventListener('click', (e) => {
        e.stopPropagation();
        handleToggleStar(msg);
      });
      starSlot.appendChild(btnStar);
    }

    const content = document.createElement('div');
    content.className = 'email-row-content';

    const top = document.createElement('div');
    top.className = 'email-row-top';

    const sender = document.createElement('span');
    sender.className = 'email-sender';

    if (state.folder === 'DRAFT' || msg.isDraft) {
      const draftTag = document.createElement('span');
      draftTag.className = 'draft-tag';
      draftTag.textContent = 'Draft';
      sender.appendChild(draftTag);
      sender.appendChild(document.createTextNode(`To: ${msg.toDisplay || '(no recipients)'}`));
    } else if (state.folder === 'SENT') {
      sender.textContent = `To: ${msg.toDisplay || '(unknown)'}`;
    } else {
      sender.textContent = msg.fromName || msg.fromEmail || 'Unknown';
    }

    const time = document.createElement('span');
    time.className = 'email-time';
    time.textContent = formatRelativeTime(msg.timestamp);

    top.append(sender, time);

    const subject = document.createElement('div');
    subject.className = 'email-subject';
    subject.textContent = msg.subject || '(no subject)';

    const snippet = document.createElement('div');
    snippet.className = 'email-snippet';
    snippet.textContent = msg.snippet || '';

    content.append(top, subject, snippet);

    const actions = buildRowQuickActions(msg);
    li.append(starSlot, content, actions);

    const activateRow = () => {
      if (state.folder === 'DRAFT' || msg.isDraft) {
        openDraftEditor(msg.draftId);
      } else {
        openMessageDetail(msg.id);
      }
    };

    li.addEventListener('click', activateRow);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateRow();
      }
    });

    fragment.appendChild(li);
  }

  els.inboxList.appendChild(fragment);
}

async function loadFolder({ showSpinner = true } = {}) {
  els.inboxError.hidden = true;
  if (showSpinner) {
    els.inboxLoading.hidden = false;
    els.inboxEmpty.hidden = true;
    els.inboxList.textContent = '';
  }

  els.btnRefresh.classList.add('is-spinning');

  try {
    const [messages, counts] = await Promise.all([
      listFolderMessages({
        folder: state.folder,
        filter: state.filter,
        query: state.query,
        maxResults: 15,
        interactive: false
      }),
      getFolderCounts({ interactive: false })
    ]);

    state.messages = messages;
    state.folderCounts = counts;
    updateUnreadIndicators(counts.inboxUnread);
    renderEmailList();
  } catch (err) {
    if (err?.code === 'AUTH_REQUIRED' || err?.code === 'CLIENT_ID_NOT_CONFIGURED') {
      state.isAuthenticated = false;
      await renderWelcomeScreen();
      return;
    }
    els.inboxErrorText.textContent = err?.message || 'Unable to load folder.';
    els.inboxError.hidden = false;
  } finally {
    els.inboxLoading.hidden = true;
    els.btnRefresh.classList.remove('is-spinning');
  }
}

async function selectFolder(folder) {
  const nextFolder = normalizeFolder(folder);
  closeDrawer();

  state.folder = nextFolder;
  state.selectedMessage = null;
  state.selectedDraft = null;
  await saveLastFolder(nextFolder);

  if (!FOLDERS[nextFolder].showUnreadFilter && state.filter === 'unread') {
    setFilterUI('all');
  }

  setActiveView('inbox');
  await loadFolder({ showSpinner: true });
}

async function handleToggleStar(msg) {
  const prevStarred = Boolean(msg.isStarred);
  const nextStarred = !prevStarred;

  msg.isStarred = nextStarred;
  msg.labelIds = nextStarred
    ? (msg.labelIds.includes('STARRED') ? msg.labelIds : [...msg.labelIds, 'STARRED'])
    : msg.labelIds.filter((l) => l !== 'STARRED');

  if (state.selectedMessage && state.selectedMessage.id === msg.id) {
    state.selectedMessage.isStarred = nextStarred;
    state.selectedMessage.labelIds = [...msg.labelIds];
    updateDetailStarButton(nextStarred);
  }

  const listSnapshot = [...state.messages];
  if (state.folder === 'STARRED' && !nextStarred) {
    state.messages = state.messages.filter((m) => m.id !== msg.id);
  }

  state.folderCounts.starredTotal = Math.max(0, state.folderCounts.starredTotal + (nextStarred ? 1 : -1));
  renderDrawerCounts();
  renderEmailList();

  try {
    await setMessageStarred(msg.id, nextStarred);
    showToast(nextStarred ? 'Added star' : 'Removed star');
  } catch (err) {
    msg.isStarred = prevStarred;
    state.messages = listSnapshot;
    await refreshFolderCounts();
    renderEmailList();
    if (state.selectedMessage && state.selectedMessage.id === msg.id) {
      state.selectedMessage.isStarred = prevStarred;
      updateDetailStarButton(prevStarred);
    }
    showToast(err?.message || 'Unable to update star');
  }
}

async function handleToggleReadFromList(msg) {
  const prevUnread = msg.isUnread;
  const nextUnread = !prevUnread;

  msg.isUnread = nextUnread;
  if (state.filter === 'unread' && !nextUnread) {
    state.messages = state.messages.filter((m) => m.id !== msg.id);
  }

  if (isInboxActiveMessage(msg)) {
    updateUnreadIndicators(Math.max(0, state.unreadCount + (nextUnread ? 1 : -1)));
  } else if (Array.isArray(msg.labelIds) && msg.labelIds.includes('SPAM')) {
    state.folderCounts.spamUnread = Math.max(0, state.folderCounts.spamUnread + (nextUnread ? 1 : -1));
    renderDrawerCounts();
  }

  renderEmailList();

  try {
    if (nextUnread) {
      await markAsUnread(msg.id);
      showToast('Marked as unread');
    } else {
      await markAsRead(msg.id);
      showToast('Marked as read');
    }
  } catch (err) {
    msg.isUnread = prevUnread;
    await loadFolder({ showSpinner: false });
    showToast(err?.message || 'Unable to update read state');
  }
}

async function handleArchiveMessage(msg, { returnToInbox = false } = {}) {
  const snapshot = [...state.messages];
  const prevUnreadCount = state.unreadCount;

  state.messages = state.messages.filter((m) => m.id !== msg.id);
  if (msg.isUnread && isInboxActiveMessage(msg)) {
    updateUnreadIndicators(Math.max(0, state.unreadCount - 1));
  }
  renderEmailList();
  if (returnToInbox) {
    state.selectedMessage = null;
    setActiveView('inbox');
  }

  try {
    await archiveMessage(msg.id);
    showToast('Conversation archived');
    refreshFolderCounts();
  } catch (err) {
    state.messages = snapshot;
    updateUnreadIndicators(prevUnreadCount);
    renderEmailList();
    showToast(err?.message || 'Unable to archive message');
  }
}

async function handleMarkNotSpam(msg, { returnToInbox = false } = {}) {
  const snapshot = [...state.messages];
  const prevUnreadCount = state.unreadCount;
  const prevSpamUnread = state.folderCounts.spamUnread;

  state.messages = state.messages.filter((m) => m.id !== msg.id);
  if (msg.isUnread) {
    state.folderCounts.spamUnread = Math.max(0, prevSpamUnread - 1);
    updateUnreadIndicators(prevUnreadCount + 1);
  }
  renderEmailList();
  if (returnToInbox) {
    state.selectedMessage = null;
    setActiveView('inbox');
  }

  try {
    await markNotSpam(msg.id);
    showToast('Moved to Inbox');
    refreshFolderCounts();
  } catch (err) {
    state.messages = snapshot;
    state.folderCounts.spamUnread = prevSpamUnread;
    updateUnreadIndicators(prevUnreadCount);
    renderEmailList();
    showToast(err?.message || 'Unable to move message out of Spam');
  }
}

async function handleRestoreFromTrash(msg, { returnToInbox = false } = {}) {
  const snapshot = [...state.messages];
  const prevUnreadCount = state.unreadCount;

  state.messages = state.messages.filter((m) => m.id !== msg.id);
  if (msg.isUnread) {
    updateUnreadIndicators(prevUnreadCount + 1);
  }
  renderEmailList();
  if (returnToInbox) {
    state.selectedMessage = null;
    setActiveView('inbox');
  }

  try {
    await restoreFromTrash(msg.id);
    showToast('Restored to Inbox');
    refreshFolderCounts();
  } catch (err) {
    state.messages = snapshot;
    updateUnreadIndicators(prevUnreadCount);
    renderEmailList();
    showToast(err?.message || 'Unable to restore message');
  }
}

async function handleTrashMessage(msg, { returnToInbox = false } = {}) {
  const snapshot = [...state.messages];
  const prevUnreadCount = state.unreadCount;

  state.messages = state.messages.filter((m) => m.id !== msg.id);
  if (msg.isUnread && isInboxActiveMessage(msg)) {
    updateUnreadIndicators(Math.max(0, state.unreadCount - 1));
  }
  renderEmailList();
  if (returnToInbox) {
    state.selectedMessage = null;
    setActiveView('inbox');
  }

  try {
    await trashMessage(msg.id);
    showToast('Moved to Trash');
    refreshFolderCounts();
  } catch (err) {
    state.messages = snapshot;
    updateUnreadIndicators(prevUnreadCount);
    renderEmailList();
    showToast(err?.message || 'Unable to move message to Trash');
  }
}

function renderDetailBody(detail) {
  els.detailBody.textContent = '';

  const hasPlain = Boolean(detail.textPlain && detail.textPlain.trim());
  const hasHtml = Boolean(detail.textHtml && detail.textHtml.trim());

  if (hasPlain && hasHtml) {
    els.detailBodyModeWrap.hidden = false;
    if (state.bodyRenderMode === 'html') {
      els.detailBodyModeLabel.textContent = 'Viewing sanitized HTML';
      els.btnToggleBodyMode.textContent = 'View plain text';
      els.detailBody.appendChild(sanitizeHtmlToFragment(detail.textHtml));
    } else {
      els.detailBodyModeLabel.textContent = 'Viewing safe plain text';
      els.btnToggleBodyMode.textContent = 'View sanitized HTML';
      els.detailBody.appendChild(renderPlainTextToFragment(detail.textPlain));
    }
    return;
  }

  if (hasPlain) {
    els.detailBodyModeWrap.hidden = true;
    els.detailBody.appendChild(renderPlainTextToFragment(detail.textPlain));
    return;
  }

  if (hasHtml) {
    els.detailBodyModeWrap.hidden = false;
    els.detailBodyModeLabel.textContent = 'HTML sanitized for security';
    els.btnToggleBodyMode.textContent = '';
    els.detailBody.appendChild(sanitizeHtmlToFragment(detail.textHtml));
    return;
  }

  els.detailBodyModeWrap.hidden = true;
  els.detailBody.appendChild(renderPlainTextToFragment(detail.snippet || '(No message content)'));
}

function renderDetailReplies(detail) {
  els.detailReplies.textContent = '';
  const replies = state.sessionSentReplies.get(detail.threadId || detail.id) || [];

  for (const reply of replies) {
    const bubble = document.createElement('div');
    bubble.className = 'sent-reply-bubble';

    const meta = document.createElement('div');
    meta.className = 'sent-reply-meta';
    meta.textContent = `You replied • ${formatRelativeTime(reply.timestamp)}`;

    const body = document.createElement('div');
    body.textContent = reply.body;

    bubble.append(meta, body);
    els.detailReplies.appendChild(bubble);
  }
}

function autoResizeReplyInput() {
  els.quickReplyInput.style.height = 'auto';
  els.quickReplyInput.style.height = `${Math.min(els.quickReplyInput.scrollHeight, 120)}px`;
}

function getActiveDraftKey() {
  if (!state.selectedMessage) return '';
  return state.selectedMessage.threadId || state.selectedMessage.id;
}

async function flushDraftNow() {
  clearTimeout(state.draftDebounceTimer);
  const key = getActiveDraftKey();
  if (!key) return;
  const text = els.quickReplyInput.value;
  await saveDraft(key, text);
  els.draftIndicator.textContent = text ? 'Draft saved locally' : 'Draft auto-saved';
}

function getEditorSessionKey(draftId) {
  return draftId ? `editor_${draftId}` : '';
}

async function flushEditorDraftNow() {
  clearTimeout(state.editorDraftDebounceTimer);
  const draft = state.selectedDraft;
  if (!draft?.draftId) return;
  const payload = JSON.stringify({
    to: els.draftToInput.value,
    subject: els.draftSubjectInput.value,
    body: els.draftBodyInput.value
  });
  await saveDraft(getEditorSessionKey(draft.draftId), payload);
}

function updateDetailReadToggleTitle(isUnread) {
  els.btnDetailToggleRead.title = isUnread ? 'Mark as read' : 'Mark as unread';
  els.btnDetailToggleRead.setAttribute('aria-label', els.btnDetailToggleRead.title);
}

function updateDetailStarButton(isStarred) {
  els.btnDetailStar.classList.toggle('is-starred', Boolean(isStarred));
  els.btnDetailStar.title = isStarred ? 'Remove star' : 'Add star';
  els.btnDetailStar.setAttribute('aria-label', els.btnDetailStar.title);
}

function updateDetailToolbarForFolder(detail) {
  const labels = Array.isArray(detail?.labelIds) ? detail.labelIds : [];
  const inSpam = state.folder === 'SPAM' || labels.includes('SPAM');
  const inTrash = state.folder === 'TRASH' || labels.includes('TRASH');
  const canArchive = !inSpam && !inTrash && isInboxActiveMessage(detail);

  els.btnDetailNotSpam.hidden = !inSpam;
  els.btnDetailRestore.hidden = !inTrash;
  els.btnDetailArchive.hidden = !canArchive;
  els.btnDetailTrash.hidden = inTrash;
  els.quickReplyForm.hidden = inSpam || inTrash;
}

async function openMessageDetail(messageId) {
  setActiveView('detail');
  els.detailSubject.textContent = 'Loading message...';
  els.detailBody.textContent = '';
  els.detailReplies.textContent = '';
  els.detailBodyModeWrap.hidden = true;

  try {
    const detail = await getMessageDetail(messageId);
    state.selectedMessage = detail;
    state.bodyRenderMode = detail.textPlain?.trim() ? 'plain' : 'html';

    els.detailSubject.textContent = detail.subject || '(no subject)';
    els.detailAvatar.textContent = getInitials(detail.fromName, detail.fromEmail);
    els.detailSenderName.textContent = detail.fromName || detail.fromEmail;
    els.detailSenderEmail.textContent = detail.fromEmail ? `<${detail.fromEmail}>` : '';
    els.detailDate.textContent = formatFullDate(detail.timestamp);
    els.detailRecipient.textContent = detail.to ? `To: ${detail.to}` : '';
    els.replyToLabel.textContent = `Reply to: ${detail.replyTo || detail.fromEmail || detail.fromName}`;

    updateDetailStarButton(detail.isStarred);
    updateDetailToolbarForFolder(detail);
    renderDetailBody(detail);
    renderDetailReplies(detail);
    els.detailScroll.scrollTop = 0;

    // Auto-mark unread messages as read when opened
    if (detail.isUnread) {
      detail.isUnread = false;
      const listItem = state.messages.find((m) => m.id === detail.id);
      if (listItem) listItem.isUnread = false;
      if (isInboxActiveMessage(detail)) {
        updateUnreadIndicators(Math.max(0, state.unreadCount - 1));
      } else if (Array.isArray(detail.labelIds) && detail.labelIds.includes('SPAM')) {
        state.folderCounts.spamUnread = Math.max(0, state.folderCounts.spamUnread - 1);
        renderDrawerCounts();
      }
      renderEmailList();
      markAsRead(detail.id).catch(() => {});
    }
    updateDetailReadToggleTitle(detail.isUnread);

    const draftKey = getActiveDraftKey();
    const savedDraft = await getDraft(draftKey);
    els.quickReplyInput.value = savedDraft;
    autoResizeReplyInput();
    els.draftIndicator.textContent = savedDraft ? 'Draft restored' : 'Draft auto-saved';

    await persistActiveViewState();
  } catch (err) {
    showToast(err?.message || 'Unable to open email');
    setActiveView('inbox');
  }
}

function htmlToPlainTextForDraft(html) {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body?.textContent || '').trim();
  } catch {
    return '';
  }
}

async function openDraftEditor(draftId) {
  if (!draftId) return;
  setActiveView('draft');
  els.draftToInput.value = '';
  els.draftSubjectInput.value = '';
  els.draftBodyInput.value = '';
  els.draftEditorStatus.textContent = 'Loading draft...';

  try {
    const detail = await getDraftDetail(draftId);
    state.selectedDraft = detail;

    let toVal = detail.to || '';
    let subjectVal = detail.subject || '';
    let bodyVal = detail.textPlain || htmlToPlainTextForDraft(detail.textHtml) || '';
    let restoredLocal = false;

    const unsavedRaw = await getDraft(getEditorSessionKey(draftId));
    if (unsavedRaw) {
      try {
        const parsed = JSON.parse(unsavedRaw);
        if (typeof parsed?.to === 'string') toVal = parsed.to;
        if (typeof parsed?.subject === 'string') subjectVal = parsed.subject;
        if (typeof parsed?.body === 'string') bodyVal = parsed.body;
        restoredLocal = true;
      } catch {
        // Ignore malformed session draft
      }
    }

    els.draftToInput.value = toVal;
    els.draftSubjectInput.value = subjectVal;
    els.draftBodyInput.value = bodyVal;
    els.draftEditorStatus.textContent = restoredLocal
      ? 'Restored unsaved local changes'
      : 'Editing draft';

    await persistActiveViewState();
  } catch (err) {
    showToast(err?.message || 'Unable to open draft');
    setActiveView('inbox');
  }
}

async function handleSaveDraft() {
  const draft = state.selectedDraft;
  if (!draft?.draftId) return;

  const to = els.draftToInput.value.trim();
  const subject = els.draftSubjectInput.value.trim();
  const body = els.draftBodyInput.value;

  els.btnDraftSave.disabled = true;
  els.draftEditorStatus.textContent = 'Saving draft...';

  try {
    await updateDraft({
      draftId: draft.draftId,
      to,
      subject,
      body,
      threadId: draft.threadId || '',
      inReplyTo: draft.inReplyTo || '',
      references: draft.references || ''
    });

    await clearDraft(getEditorSessionKey(draft.draftId));
    els.draftEditorStatus.textContent = 'Saved to Gmail';
    showToast('Draft saved');
    loadFolder({ showSpinner: false });
  } catch (err) {
    els.draftEditorStatus.textContent = 'Failed to save draft';
    showToast(err?.message || 'Unable to save draft');
  } finally {
    els.btnDraftSave.disabled = false;
  }
}

async function handleSendDraft() {
  const draft = state.selectedDraft;
  if (!draft?.draftId) return;

  const to = els.draftToInput.value.trim();
  const subject = els.draftSubjectInput.value.trim();
  const body = els.draftBodyInput.value;

  if (!to) {
    showToast('Please enter a recipient email address');
    els.draftToInput.focus();
    return;
  }

  els.btnDraftSend.disabled = true;
  els.btnDraftSave.disabled = true;
  els.draftEditorStatus.textContent = 'Sending...';

  try {
    await sendDraft({
      draftId: draft.draftId,
      to,
      subject,
      body,
      threadId: draft.threadId || '',
      inReplyTo: draft.inReplyTo || '',
      references: draft.references || ''
    });

    await clearDraft(getEditorSessionKey(draft.draftId));
    state.selectedDraft = null;
    state.folderCounts.draftTotal = Math.max(0, state.folderCounts.draftTotal - 1);
    renderDrawerCounts();

    setActiveView('inbox');
    await loadFolder({ showSpinner: true });
    showToast('Message sent');
  } catch (err) {
    els.draftEditorStatus.textContent = 'Failed to send';
    showToast(err?.message || 'Unable to send draft');
  } finally {
    els.btnDraftSend.disabled = false;
    els.btnDraftSave.disabled = false;
  }
}

async function handleDeleteDraft(draftId, { fromList = false } = {}) {
  if (!draftId) return;
  const snapshot = [...state.messages];

  state.messages = state.messages.filter((m) => m.draftId !== draftId);
  state.folderCounts.draftTotal = Math.max(0, state.folderCounts.draftTotal - 1);
  renderDrawerCounts();
  renderEmailList();

  if (!fromList) {
    state.selectedDraft = null;
    setActiveView('inbox');
  }

  try {
    await deleteDraft(draftId);
    await clearDraft(getEditorSessionKey(draftId));
    showToast('Draft discarded');
  } catch (err) {
    state.messages = snapshot;
    await refreshFolderCounts();
    renderEmailList();
    showToast(err?.message || 'Unable to discard draft');
  }
}

async function handleSendQuickReply(e) {
  e.preventDefault();
  const detail = state.selectedMessage;
  if (!detail) return;

  const body = els.quickReplyInput.value.trim();
  if (!body) {
    showToast('Please enter a reply');
    els.quickReplyInput.focus();
    return;
  }

  const recipient = detail.replyTo || detail.fromEmail || detail.fromRaw;
  if (!recipient) {
    showToast('Recipient address not found');
    return;
  }

  els.btnSendReply.disabled = true;
  els.quickReplyInput.disabled = true;
  els.btnSendReply.textContent = 'Sending...';

  try {
    await sendQuickReply({
      to: recipient,
      subject: detail.subject,
      body,
      threadId: detail.threadId,
      inReplyTo: detail.messageIdHeader,
      references: detail.references
    });

    const draftKey = getActiveDraftKey();
    clearTimeout(state.draftDebounceTimer);
    await clearDraft(draftKey);

    els.quickReplyInput.value = '';
    autoResizeReplyInput();
    els.draftIndicator.textContent = 'Reply sent';

    const replyRecord = {
      id: `reply-${Date.now()}`,
      to: recipient,
      subject: detail.subject,
      body,
      timestamp: Date.now()
    };

    const threadKey = detail.threadId || detail.id;
    const existing = state.sessionSentReplies.get(threadKey) || [];
    state.sessionSentReplies.set(threadKey, [...existing, replyRecord]);

    renderDetailReplies(detail);
    els.detailScroll.scrollTop = els.detailScroll.scrollHeight;
    showToast('Reply sent');
  } catch (err) {
    showToast(err?.message || 'Failed to send reply');
  } finally {
    els.btnSendReply.disabled = false;
    els.quickReplyInput.disabled = false;
    els.btnSendReply.textContent = 'Send';
  }
}

async function openSettingsView() {
  closeDrawer();
  if (state.currentView !== 'settings') {
    state.previousViewBeforeSettings = state.currentView;
  }

  const [settings, authState] = await Promise.all([getSettings(), getAuthState()]);

  if (state.isAuthenticated) {
    els.settingsAccountValue.textContent = state.userEmail || authState?.userEmail || 'Connected to Google';
    els.settingsAuthMethod.textContent =
      authState?.authMethod === 'webAuthFlow'
        ? 'Authenticated via OAuth 2.0 Web Flow'
        : 'Authenticated via Chrome Identity Token';
  } else {
    els.settingsAccountValue.textContent = 'Not signed in';
    els.settingsAuthMethod.textContent = isEdgeBrowser()
      ? 'Microsoft Edge (uses Web Auth Flow)'
      : 'Google Chrome (supports native getAuthToken)';
  }

  els.settingsPollInterval.value = String(settings.pollIntervalMinutes);
  els.settingsNotifications.checked = settings.notificationsEnabled;
  els.settingsWebClientId.value = settings.webClientId || '';
  els.settingsRedirectUrl.textContent = getRedirectUrl() || 'chrome.identity.getRedirectURL()';

  setActiveView('settings');
}

async function handleSignIn() {
  els.welcomeError.hidden = true;
  els.btnSignIn.disabled = true;
  els.btnSignIn.textContent = 'Signing in...';

  try {
    await getAuthToken({ interactive: true });
    state.isAuthenticated = true;
    state.folder = await getLastFolder();

    const profile = await getProfile({ interactive: false }).catch(() => null);
    if (profile?.emailAddress) {
      state.userEmail = profile.emailAddress;
      await saveAuthState({ userEmail: profile.emailAddress });
    }

    setActiveView('inbox');
    await loadFolder({ showSpinner: true });
    sendBackgroundMessage({ type: 'SYNC_BADGE' });
  } catch (err) {
    let msg = err?.message || 'Google sign-in failed.';
    if (err?.code === 'CLIENT_ID_NOT_CONFIGURED') {
      msg = 'Google OAuth Client ID is not configured. See README.md to add your Client ID.';
    } else if (err?.code === 'USER_CANCELLED') {
      msg = 'Sign-in was cancelled.';
    }
    await renderWelcomeScreen(msg);
  } finally {
    els.btnSignIn.disabled = false;
    els.btnSignIn.textContent = 'Sign in with Google';
  }
}

async function handleSignOut() {
  els.btnSignOut.disabled = true;
  try {
    await signOut();
    state.isAuthenticated = false;
    state.userEmail = '';
    state.folder = 'INBOX';
    state.messages = [];
    state.selectedMessage = null;
    state.selectedDraft = null;
    state.sessionSentReplies.clear();
    els.quickReplyInput.value = '';
    await sendBackgroundMessage({ type: 'CLEAR_BADGE' });
    await renderWelcomeScreen();
    showToast('Signed out and local data cleared');
  } finally {
    els.btnSignOut.disabled = false;
  }
}

function handleOpenSidePanel() {
  if (typeof chrome.sidePanel?.open !== 'function' || state.windowId == null) {
    showToast('Open the Side Panel from your browser toolbar');
    return;
  }

  persistActiveViewState().catch(() => {});
  flushDraftNow().catch(() => {});
  flushEditorDraftNow().catch(() => {});

  // Call chrome.sidePanel.open synchronously inside the click handler to preserve the user gesture
  chrome.sidePanel
    .open({ windowId: state.windowId })
    .then(() => {
      window.close();
    })
    .catch(() => {
      showToast('Unable to open Side Panel automatically');
    });
}

async function restoreSessionView() {
  const [activeState, lastFolder] = await Promise.all([getActiveViewState(), getLastFolder()]);
  state.folder = normalizeFolder(activeState?.folder || lastFolder || 'INBOX');

  if (activeState?.filter && FOLDERS[state.folder].showUnreadFilter) {
    setFilterUI(activeState.filter);
  } else {
    setFilterUI('all');
  }

  if (typeof activeState?.query === 'string') {
    state.query = activeState.query;
    els.searchInput.value = state.query;
    els.btnClearSearch.hidden = !state.query;
  }

  setActiveView('inbox');
  await loadFolder({ showSpinner: true });

  if (activeState?.view === 'draft' && activeState.draftId) {
    await openDraftEditor(activeState.draftId);
  } else if (activeState?.view === 'detail' && activeState.messageId) {
    await openMessageDetail(activeState.messageId);
  }
}

async function initSessionState() {
  const configured = await isClientIdConfigured();
  if (!configured) {
    state.isAuthenticated = false;
    await renderWelcomeScreen();
    return;
  }

  const authState = await getAuthState();

  try {
    await getAuthToken({ interactive: false });
    state.isAuthenticated = true;
    state.userEmail = authState?.userEmail || '';

    if (!state.userEmail) {
      const profile = await getProfile({ interactive: false }).catch(() => null);
      if (profile?.emailAddress) {
        state.userEmail = profile.emailAddress;
        await saveAuthState({ userEmail: profile.emailAddress });
      }
    }

    await restoreSessionView();
  } catch {
    state.isAuthenticated = false;
    await renderWelcomeScreen();
  }
}

function bindEvents() {
  els.btnMenu.addEventListener('click', () => {
    if (isDrawerOpen()) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });

  els.btnCloseDrawer.addEventListener('click', closeDrawer);
  els.navBackdrop.addEventListener('click', closeDrawer);

  for (const item of els.drawerItems) {
    item.addEventListener('click', () => {
      const targetFolder = item.dataset.folder;
      if (targetFolder) {
        selectFolder(targetFolder);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isDrawerOpen()) {
      e.preventDefault();
      closeDrawer();
    }
  });

  els.btnRefresh.addEventListener('click', () => {
    if (state.currentView === 'detail' && state.selectedMessage) {
      openMessageDetail(state.selectedMessage.id);
    } else if (state.currentView === 'draft' && state.selectedDraft) {
      openDraftEditor(state.selectedDraft.draftId);
    } else if (state.isAuthenticated) {
      loadFolder({ showSpinner: true });
    }
  });

  els.btnOpenSidePanel.addEventListener('click', handleOpenSidePanel);

  els.btnSettings.addEventListener('click', () => {
    if (state.currentView === 'settings') {
      const backTarget =
        state.previousViewBeforeSettings && state.previousViewBeforeSettings !== 'settings'
          ? state.previousViewBeforeSettings
          : state.isAuthenticated
            ? 'inbox'
            : 'welcome';
      setActiveView(backTarget);
      return;
    }
    openSettingsView();
  });

  els.btnSettingsBack.addEventListener('click', () => {
    let target = 'welcome';
    if (state.isAuthenticated) {
      if (state.previousViewBeforeSettings === 'detail' && state.selectedMessage) {
        target = 'detail';
      } else if (state.previousViewBeforeSettings === 'draft' && state.selectedDraft) {
        target = 'draft';
      } else {
        target = 'inbox';
      }
    }
    setActiveView(target);
  });

  els.btnSignIn.addEventListener('click', handleSignIn);
  els.btnRetryInbox.addEventListener('click', () => loadFolder({ showSpinner: true }));

  els.filterAll.addEventListener('click', () => {
    if (state.filter === 'all') return;
    setFilterUI('all');
    persistActiveViewState().catch(() => {});
    loadFolder({ showSpinner: true });
  });

  els.filterUnread.addEventListener('click', () => {
    if (state.filter === 'unread') return;
    setFilterUI('unread');
    persistActiveViewState().catch(() => {});
    loadFolder({ showSpinner: true });
  });

  els.searchInput.addEventListener('input', () => {
    const val = els.searchInput.value;
    els.btnClearSearch.hidden = !val;
    clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(() => {
      state.query = val.trim();
      persistActiveViewState().catch(() => {});
      loadFolder({ showSpinner: true });
    }, 320);
  });

  els.btnClearSearch.addEventListener('click', () => {
    els.searchInput.value = '';
    els.btnClearSearch.hidden = true;
    state.query = '';
    persistActiveViewState().catch(() => {});
    loadFolder({ showSpinner: true });
    els.searchInput.focus();
  });

  els.btnBack.addEventListener('click', async () => {
    await flushDraftNow();
    state.selectedMessage = null;
    setActiveView('inbox');
  });

  els.btnDetailStar.addEventListener('click', () => {
    if (!state.selectedMessage) return;
    const listMatch = state.messages.find((m) => m.id === state.selectedMessage.id) || state.selectedMessage;
    handleToggleStar(listMatch);
  });

  els.btnDetailNotSpam.addEventListener('click', () => {
    if (state.selectedMessage) {
      handleMarkNotSpam(state.selectedMessage, { returnToInbox: true });
    }
  });

  els.btnDetailRestore.addEventListener('click', () => {
    if (state.selectedMessage) {
      handleRestoreFromTrash(state.selectedMessage, { returnToInbox: true });
    }
  });

  els.btnDetailToggleRead.addEventListener('click', async () => {
    const detail = state.selectedMessage;
    if (!detail) return;
    const nextUnread = !detail.isUnread;
    detail.isUnread = nextUnread;
    updateDetailReadToggleTitle(nextUnread);

    const listItem = state.messages.find((m) => m.id === detail.id);
    if (listItem) listItem.isUnread = nextUnread;
    if (state.filter === 'unread' && !nextUnread) {
      state.messages = state.messages.filter((m) => m.id !== detail.id);
    }

    if (isInboxActiveMessage(detail)) {
      updateUnreadIndicators(Math.max(0, state.unreadCount + (nextUnread ? 1 : -1)));
    } else if (Array.isArray(detail.labelIds) && detail.labelIds.includes('SPAM')) {
      state.folderCounts.spamUnread = Math.max(0, state.folderCounts.spamUnread + (nextUnread ? 1 : -1));
      renderDrawerCounts();
    }
    renderEmailList();

    try {
      if (nextUnread) {
        await markAsUnread(detail.id);
        showToast('Marked as unread');
      } else {
        await markAsRead(detail.id);
        showToast('Marked as read');
      }
    } catch (err) {
      detail.isUnread = !nextUnread;
      updateDetailReadToggleTitle(detail.isUnread);
      showToast(err?.message || 'Unable to update read state');
    }
  });

  els.btnDetailArchive.addEventListener('click', () => {
    if (state.selectedMessage) {
      handleArchiveMessage(state.selectedMessage, { returnToInbox: true });
    }
  });

  els.btnDetailTrash.addEventListener('click', () => {
    if (state.selectedMessage) {
      handleTrashMessage(state.selectedMessage, { returnToInbox: true });
    }
  });

  els.btnOpenInGmail.addEventListener('click', () => {
    const msg = state.selectedMessage;
    const hash = FOLDERS[state.folder]?.gmailHash || '#inbox';
    const url = msg?.threadId
      ? `${GMAIL_WEB_BASE}${hash}/${encodeURIComponent(msg.threadId)}`
      : `${GMAIL_WEB_BASE}${hash}`;
    if (typeof chrome.tabs?.create === 'function') {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  });

  els.btnToggleBodyMode.addEventListener('click', () => {
    if (!state.selectedMessage) return;
    state.bodyRenderMode = state.bodyRenderMode === 'plain' ? 'html' : 'plain';
    renderDetailBody(state.selectedMessage);
  });

  els.quickReplyInput.addEventListener('input', () => {
    autoResizeReplyInput();
    const key = getActiveDraftKey();
    if (!key) return;
    const text = els.quickReplyInput.value;
    els.draftIndicator.textContent = 'Saving draft...';
    clearTimeout(state.draftDebounceTimer);
    state.draftDebounceTimer = setTimeout(() => {
      saveDraft(key, text)
        .then(() => {
          els.draftIndicator.textContent = text ? 'Draft saved locally' : 'Draft auto-saved';
        })
        .catch(() => {});
    }, 180);
  });

  els.quickReplyInput.addEventListener('blur', () => {
    flushDraftNow().catch(() => {});
  });

  els.quickReplyInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      els.quickReplyForm.requestSubmit();
    }
  });

  els.quickReplyForm.addEventListener('submit', handleSendQuickReply);

  els.btnDraftBack.addEventListener('click', async () => {
    await flushEditorDraftNow();
    state.selectedDraft = null;
    setActiveView('inbox');
  });

  els.btnDraftSave.addEventListener('click', handleSaveDraft);
  els.btnDraftSend.addEventListener('click', handleSendDraft);
  els.btnDraftDelete.addEventListener('click', () => {
    if (state.selectedDraft?.draftId) {
      handleDeleteDraft(state.selectedDraft.draftId, { fromList: false });
    }
  });

  const scheduleEditorSessionSave = () => {
    if (!state.selectedDraft?.draftId) return;
    els.draftEditorStatus.textContent = 'Unsaved changes';
    clearTimeout(state.editorDraftDebounceTimer);
    state.editorDraftDebounceTimer = setTimeout(() => {
      flushEditorDraftNow().catch(() => {});
    }, 220);
  };

  els.draftToInput.addEventListener('input', scheduleEditorSessionSave);
  els.draftSubjectInput.addEventListener('input', scheduleEditorSessionSave);
  els.draftBodyInput.addEventListener('input', scheduleEditorSessionSave);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushDraftNow().catch(() => {});
      flushEditorDraftNow().catch(() => {});
    }
  });

  els.settingsPollInterval.addEventListener('change', async () => {
    const minutes = Number(els.settingsPollInterval.value);
    const saved = await saveSettings({ pollIntervalMinutes: minutes });
    await sendBackgroundMessage({ type: 'UPDATE_POLL_INTERVAL', minutes: saved.pollIntervalMinutes });
    showToast(`Checking every ${saved.pollIntervalMinutes} min`);
  });

  els.settingsNotifications.addEventListener('change', async () => {
    const enabled = els.settingsNotifications.checked;
    await saveSettings({ notificationsEnabled: enabled });
    showToast(enabled ? 'Desktop notifications enabled' : 'Desktop notifications disabled');
  });

  els.btnCopyRedirectUrl.addEventListener('click', async () => {
    const url = getRedirectUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Redirect URI copied');
    } catch {
      showToast('Unable to copy automatically');
    }
  });

  els.btnSaveWebClientId.addEventListener('click', async () => {
    const value = els.settingsWebClientId.value.trim();
    if (value && !isValidClientId(value)) {
      showToast('Invalid Client ID');
      return;
    }
    await saveSettings({ webClientId: value });
    showToast(value ? 'Web OAuth Client ID saved' : 'Web OAuth Client ID cleared');
    if (!state.isAuthenticated && !isManifestClientIdConfigured()) {
      await renderWelcomeScreen();
    }
  });

  els.btnSignOut.addEventListener('click', handleSignOut);
}

function initPrivacyLinks() {
  const privacyUrl = getPrivacyPolicyUrl();
  const links = [els.linkWelcomePrivacy, els.linkDrawerPrivacy, els.linkSettingsPrivacy];

  for (const link of links) {
    if (!link) continue;
    link.href = privacyUrl;
    link.addEventListener('click', (e) => {
      if (link === els.linkDrawerPrivacy) {
        closeDrawer();
      }
      if (typeof chrome.tabs?.create === 'function') {
        e.preventDefault();
        chrome.tabs.create({ url: privacyUrl });
      }
    });
  }
}

async function init() {
  initPrivacyLinks();
  bindEvents();

  if (typeof chrome.windows?.getCurrent === 'function') {
    chrome.windows.getCurrent((win) => {
      if (win?.id != null) {
        state.windowId = win.id;
      }
    });
  }

  await initSessionState();
}

init();
