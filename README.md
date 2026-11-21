# Quick Mail: Mini Inbox for Gmail

A **Manifest V3** browser extension for **Google Chrome** and **Microsoft Edge**. It operates **100% client-side (zero backend)** using plain HTML, CSS, and JavaScript ES Modules with no build step required.

## Key Features

- **Gmail-style 6-Folder Navigation Drawer (`☰`):** Browse **Inbox**, **Starred**, **Sent**, **Drafts**, **Spam**, and **Trash** smoothly inside both the `400px × 580px` Popup and responsive Side Panel, remembering your last opened folder.
- **Real-Time Inbox Unread Badge:** Periodic background polling via `chrome.alarms` (`1`, `3`, or `5` min intervals), showing `1–99` or `99+` in white over red `#EA4335` (hidden at `0`), strictly counting `INBOX` unread messages only (never `SPAM` or `TRASH`), plus optional `chrome.notifications`.
- **Popup & Side Panel Handoff:** Expand any view into the persistent Side Panel (`chrome.sidePanel.open()`) without losing unsent replies or draft edits.
- **Full Actions Within Minimal `gmail.modify` Scope:**
  - 1-tap Star toggle on message rows and in detail view.
  - `Spam` and `Trash` queried with `includeSpamTrash=true`, featuring **Not spam** and **Restore to Inbox** recovery buttons (no permanent `DELETE /messages/{id}`).
  - Quick Draft editor with **Save Draft** (`PUT /drafts/{id}`), **Send** (`POST /drafts/send`), and **Discard Draft** (`DELETE /drafts/{id}`).
  - `Sent` folder displays `To: <recipient>` summaries.
- **Quick Reply & Session Draft Persistence:** Fixed bottom composer sending `POST /messages/send` with `threadId`, `In-Reply-To`, and `References`, automatically saving unsent text to `chrome.storage.session`.
- **XSS-Safe Rendering & Prominent Privacy Disclosure:** Prefers `text/plain`, strictly sanitizes HTML via `DOMParser` allowlists, hides remote tracking images, and surfaces a prominent data disclosure + Privacy Policy link on the Welcome screen, Drawer, and Settings.

---

## 1. Google Cloud Console & OAuth 2.0 Setup

### Step A: Create Project & Enable Gmail API
1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (for example, `Quick Mail Extension`).
3. Go to **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.

### Step B: Configure OAuth Consent Screen
1. Go to **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Branding / Audience**).
2. Choose **External** user type.
3. Fill in the app name (`Quick Mail: Mini Inbox for Gmail`), user support email, and developer contact email.
4. Under **Scopes**, add:
   - `https://www.googleapis.com/auth/gmail.modify`
5. Under **Test users**, add Gmail accounts used for testing (up to 100 test users while in **Testing** status).

### Step C: Load Unpacked & Note Extension ID
1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Microsoft Edge).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project folder (`d:\VIBECODING\Extendsion`).
4. Copy the 32-character **Extension ID** shown on the extension card.

### Step D: Create Chrome OAuth Client ID
1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Choose **Application type**: **Chrome Extension**.
3. Enter your **Item ID** (the Extension ID from Step C).
4. Copy the generated Client ID (`xxxxxxxxxx.apps.googleusercontent.com`) into `oauth2.client_id` inside [`manifest.json`](manifest.json).
5. Reload the extension in `chrome://extensions`.

### Step E: Configure Microsoft Edge OAuth (`launchWebAuthFlow`)
Microsoft Edge does not support `chrome.identity.getAuthToken()`, so Quick Mail automatically falls back to `chrome.identity.launchWebAuthFlow()`:
1. In **Google Cloud Console → Credentials → Create Credentials → OAuth client ID**, select **Application type**: **Web application**.
2. Open **Settings** inside Quick Mail (or use the format below) to copy the extension's Redirect URI:
   ```text
   https://<EDGE_EXTENSION_ID>.chromiumapp.org/
   ```
3. Add that Redirect URI under **Authorized redirect URIs** and click **Save**.
4. Paste the Web Application Client ID into **Settings → Edge / Web OAuth Configuration → Save**.

---

## 2. Configure Public Privacy Policy URL (`js/config.js`)

Before submitting to Chrome Web Store, Edge Add-ons, or Google OAuth Verification:

1. Host [`docs/privacy-policy.html`](docs/privacy-policy.html) on **GitHub Pages** (Repository **Settings → Pages → Deploy from branch → `/docs`**) or any public HTTPS site.
2. Open [`js/config.js`](js/config.js) and replace `PRIVACY_POLICY_URL` with your live public URL:
   ```js
   export const PRIVACY_POLICY_URL =
     'https://<YOUR_GITHUB_USERNAME>.github.io/<YOUR_REPO_NAME>/privacy-policy.html';
   ```
3. During local testing while placeholders are still present, `getPrivacyPolicyUrl()` falls back to `chrome.runtime.getURL("docs/privacy-policy.html")` so privacy links never 404.

---

## 3. Packaging a Clean Release ZIP for Store Submission

Before creating the `.zip` archive for **Chrome Web Store** or **Microsoft Edge Add-ons**:

1. Verify `oauth2.client_id` in [`manifest.json`](manifest.json) is your production Google OAuth Client ID.
2. Verify `PRIVACY_POLICY_URL` in [`js/config.js`](js/config.js) points to your live HTTPS Privacy Policy page.
3. Include **only** the extension runtime files at the root of the `.zip` archive:
   - `manifest.json`
   - `background.js`
   - `popup.html`
   - `sidepanel.html`
   - `js/` (`app.js`, `auth.js`, `config.js`, `gmail-api.js`, `sanitize.js`, `storage.js`, `utils.js`)
   - `css/` (`styles.css`)
   - `icons/` (`icon16.png`, `icon48.png`, `icon128.png`)
4. **Exclude** non-runtime files from the `.zip` package:
   - `README.md`, `STORE_CHECKLIST.md`, `docs/`, and any `*.md` notes
   - `.git/`, `.DS_Store`, `Thumbs.db`, and any temporary test files

Refer to [`STORE_CHECKLIST.md`](STORE_CHECKLIST.md) for pre-filled Store Listing and OAuth Verification fields.
