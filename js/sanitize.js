const BLOCKED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'meta',
  'link',
  'base',
  'svg',
  'math',
  'noscript',
  'template',
  'audio',
  'video',
  'source',
  'canvas',
  'head',
  'title'
]);

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td'
]);

const URL_REGEX = /(https?:\/\/[^\s<>"'`]+)/gi;

/**
 * Validate a hyperlink URI against a strict http/https/mailto allowlist.
 * Strips whitespace and ASCII control characters before checking scheme to prevent obfuscated payloads.
 * @param {string} rawHref
 * @returns {string}
 */
function sanitizeHref(rawHref) {
  if (!rawHref || typeof rawHref !== 'string') return '';
  const cleaned = rawHref.replace(/[\u0000-\u001F\u007F]+/g, '').trim();
  if (!cleaned) return '';

  if (/^mailto:/i.test(cleaned)) {
    return /^mailto:[^\s<>"]+$/i.test(cleaned) ? cleaned : '';
  }

  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return '';
  }

  return '';
}

function appendSanitizedChildren(sourceNode, targetParent) {
  for (const child of sourceNode.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      targetParent.appendChild(document.createTextNode(child.textContent || ''));
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      continue;
    }

    const tag = child.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tag)) {
      continue;
    }

    if (tag === 'img') {
      const alt = (child.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const placeholder = document.createElement('span');
      placeholder.className = 'qm-hidden-img';
      placeholder.textContent = alt
        ? `[Image hidden: ${alt}]`
        : '[Image hidden for privacy]';
      targetParent.appendChild(placeholder);
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      appendSanitizedChildren(child, targetParent);
      continue;
    }

    if (tag === 'a') {
      const safeHref = sanitizeHref(child.getAttribute('href') || '');
      if (!safeHref) {
        const span = document.createElement('span');
        appendSanitizedChildren(child, span);
        targetParent.appendChild(span);
        continue;
      }

      const anchor = document.createElement('a');
      anchor.setAttribute('href', safeHref);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
      appendSanitizedChildren(child, anchor);
      targetParent.appendChild(anchor);
      continue;
    }

    const cleanEl = document.createElement(tag);
    appendSanitizedChildren(child, cleanEl);
    targetParent.appendChild(cleanEl);
  }
}

/**
 * Strictly sanitize HTML email content using DOMParser and an explicit tag/attribute allowlist.
 * Never injects raw `innerHTML` or event attributes.
 * @param {string} rawHtml
 * @returns {DocumentFragment}
 */
export function sanitizeHtmlToFragment(rawHtml) {
  const fragment = document.createDocumentFragment();
  if (!rawHtml || typeof rawHtml !== 'string') {
    return fragment;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  if (doc?.body) {
    appendSanitizedChildren(doc.body, fragment);
  }
  return fragment;
}

/**
 * Render plain text email content safely as text nodes with auto-linked https/http URLs.
 * @param {string} plainText
 * @returns {DocumentFragment}
 */
export function renderPlainTextToFragment(plainText) {
  const fragment = document.createDocumentFragment();
  const normalized = String(plainText || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  lines.forEach((line, lineIndex) => {
    let lastIndex = 0;
    URL_REGEX.lastIndex = 0;

    let match;
    while ((match = URL_REGEX.exec(line)) !== null) {
      let urlText = match[0];
      let trailing = '';

      // Strip common trailing punctuation from prose URLs
      while (/[.,;:!?)]$/.test(urlText)) {
        if (urlText.endsWith(')') && (urlText.match(/\(/g)?.length || 0) >= (urlText.match(/\)/g)?.length || 0)) {
          break;
        }
        trailing = urlText.slice(-1) + trailing;
        urlText = urlText.slice(0, -1);
      }

      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
      }

      const safeHref = sanitizeHref(urlText);
      if (safeHref) {
        const anchor = document.createElement('a');
        anchor.setAttribute('href', safeHref);
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
        anchor.textContent = urlText;
        fragment.appendChild(anchor);
      } else {
        fragment.appendChild(document.createTextNode(urlText));
      }

      if (trailing) {
        fragment.appendChild(document.createTextNode(trailing));
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < line.length) {
      fragment.appendChild(document.createTextNode(line.slice(lastIndex)));
    }

    if (lineIndex < lines.length - 1) {
      fragment.appendChild(document.createElement('br'));
    }
  });

  return fragment;
}
