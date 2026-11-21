# Store Submission Checklist (Chrome Web Store & Edge Add-ons)

Use this checklist when filling out **Store Listing**, **Privacy Practices**, and **Google OAuth Verification** for **Quick Mail: Mini Inbox for Gmail**.

---

## 1. Brand & Trademark Compliance
- **Extension Name:** `Quick Mail: Mini Inbox for Gmail` (neutral name; does not start with `"Gmail"`).
- **Icons:** Custom minimalist blue-violet envelope PNG icons (`icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`) with zero Google/Gmail trademarks.
- **Store Graphics to Prepare:**
  - Screenshots (`1280×800` or `640×400`) showing the Popup, Side Panel, Navigation Drawer, and Quick Reply using a clean test account.
  - Small promo tile (`440×280`, optional).

---

## 2. Single Purpose Description

> **Single Purpose:**
> Quick Mail: Mini Inbox for Gmail provides a lightweight toolbar unread badge counter and a compact Popup / Side Panel inbox viewer so users can check unread Gmail counts, browse standard folders (Inbox, Starred, Sent, Drafts, Spam, Trash), read emails safely, triage messages, and send quick replies without leaving their current browser tab.

---

## 3. Permission Justifications

| Permission / Host | Justification (Ready to Copy for Store Review) |
|---|---|
| `identity` | Used solely to authenticate the user with Google OAuth 2.0 via `chrome.identity.getAuthToken` on Chrome and `chrome.identity.launchWebAuthFlow` on Microsoft Edge to obtain a scoped access token for the Gmail API. |
| `alarms` | Schedules periodic background checks (`1`, `3`, or `5` minutes as configured by the user) to refresh the Inbox unread badge count while keeping the Manifest V3 service worker dormant between checks. |
| `storage` | Stores local user preferences (polling interval, notification toggle, optional Edge Web Client ID, last opened folder) in `chrome.storage.local` and temporary unsent reply/draft edits in `chrome.storage.session`. |
| `sidePanel` | Allows the user to expand the mini inbox into the browser Side Panel via `chrome.sidePanel.open()` so writing replies is not interrupted when clicking outside the Popup. |
| `notifications` | Displays optional desktop notifications via `chrome.notifications` when new unread Inbox emails arrive, controlled by a toggle in Settings. |
| `https://gmail.googleapis.com/*` | Required so the extension communicates directly from the user's browser (100% client-side, zero intermediate servers) with the official Gmail REST API v1. |
| **Remote Code** | **No, I am not using remote code.** All HTML, CSS, and ES Module JavaScript are bundled locally inside the extension and comply with `script-src 'self'; object-src 'self';`. |

---

## 4. Privacy Policy URL & Data Usage Disclosures

1. Publish [`docs/privacy-policy.html`](docs/privacy-policy.html) on **GitHub Pages** (Settings → Pages → Deploy from branch → `/docs`) or an HTTPS domain you control.
2. Update `PRIVACY_POLICY_URL` in [`js/config.js`](js/config.js) with that exact live HTTPS URL (used by the Welcome screen, Navigation Drawer, and Settings).
3. Enter the same live HTTPS URL in the **Privacy Policy URL** field on Chrome Web Store Developer Dashboard and Edge Partner Center.
4. Under **Data Usage** (Chrome Web Store):
   - Declare **Personal communications** (email content/metadata) and **Authentication information** (OAuth tokens).
   - Certify all limited-use commitments: data is never sold, never used for advertising or creditworthiness, and used solely for the extension's single purpose.
   - Verify that [`docs/privacy-policy.html`](docs/privacy-policy.html) retains the verbatim **Google API Services User Data Policy (including the Limited Use requirements)** statement.

---

## 5. Final Pre-Packaging Checks & Google OAuth Verification

Before zipping and submitting:
1. **Replace OAuth Client ID (`manifest.json`):** Confirm `oauth2.client_id` in [`manifest.json`](manifest.json) is your production Google Cloud Client ID (not a placeholder).
2. **Replace Privacy Policy URL (`js/config.js`):** Confirm `PRIVACY_POLICY_URL` in [`js/config.js`](js/config.js) is your live public HTTPS URL.
3. **Clean ZIP Contents:** Package only `manifest.json`, `background.js`, `popup.html`, `sidepanel.html`, `js/`, `css/`, and `icons/` (exclude markdown docs and repository metadata).
4. **Google OAuth App Verification (> 100 Users):**
   - `https://www.googleapis.com/auth/gmail.modify` is a Google **Restricted Scope**.
   - While your OAuth consent screen is in **Testing** mode, up to **100 test users** can sign in.
   - To publish in **Production** for all users, complete **Google OAuth App Verification** (including a walkthrough video showing the Welcome screen disclosure, OAuth consent screen, and `gmail.modify` usage) and pass a **CASA Tier 2** security assessment.
