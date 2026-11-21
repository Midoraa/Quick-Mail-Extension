/**
 * Centralized Privacy Policy URL configuration for Chrome Web Store & Google OAuth verification.
 * Replace `YOUR_GITHUB_USERNAME` and `YOUR_REPO_NAME` with your published GitHub Pages
 * (or custom HTTPS domain) URL before submitting to the Store or Google OAuth Verification.
 */
export const PRIVACY_POLICY_URL =
  'https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/privacy-policy.html';

const LOCAL_PRIVACY_POLICY_PATH = 'docs/privacy-policy.html';

/**
 * Check whether `PRIVACY_POLICY_URL` has been replaced with a real public HTTPS URL.
 * @param {string} [url]
 * @returns {boolean}
 */
export function isPrivacyPolicyUrlConfigured(url = PRIVACY_POLICY_URL) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return false;
  if (trimmed.includes('YOUR_GITHUB_USERNAME') || trimmed.includes('YOUR_REPO_NAME')) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Return the public Privacy Policy URL when configured, or automatically fall back
 * to the extension's bundled `docs/privacy-policy.html` during local testing.
 * @param {string} [url]
 * @returns {string}
 */
export function getPrivacyPolicyUrl(url = PRIVACY_POLICY_URL) {
  if (isPrivacyPolicyUrlConfigured(url)) {
    return String(url).trim();
  }
  return chrome.runtime?.getURL?.(LOCAL_PRIVACY_POLICY_PATH) || LOCAL_PRIVACY_POLICY_PATH;
}
