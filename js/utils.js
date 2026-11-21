const utf8Decoder = new TextDecoder('utf-8');
const utf8Encoder = new TextEncoder();

const NAMED_HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®'
};

/**
 * Decode a Gmail base64url-encoded UTF-8 string without corrupting multi-byte characters.
 * @param {string} base64Url
 * @returns {string}
 */
export function base64UrlDecodeUtf8(base64Url) {
  if (!base64Url || typeof base64Url !== 'string') return '';
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  else if (pad === 1) return '';

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return utf8Decoder.decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Encode a UTF-8 string into standard Base64.
 * @param {string} str
 * @returns {string}
 */
export function base64EncodeUtf8(str) {
  const bytes = utf8Encoder.encode(str || '');
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Encode a UTF-8 string into URL-safe Base64 (no padding) for Gmail API `raw`.
 * @param {string} str
 * @returns {string}
 */
export function base64UrlEncodeUtf8(str) {
  return base64EncodeUtf8(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Strip CR and LF characters to prevent email header injection.
 * @param {string} value
 * @returns {string}
 */
export function sanitizeHeaderValue(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Encode non-ASCII header text using RFC 2047 UTF-8 Base64 encoded-word syntax.
 * @param {string} text
 * @returns {string}
 */
export function encodeRfc2047(text) {
  const clean = sanitizeHeaderValue(text);
  if (!clean) return '';
  if (/^[\x20-\x7E]*$/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${base64EncodeUtf8(clean)}?=`;
}

/**
 * Wrap a base64 string into 76-character CRLF lines per RFC 2045.
 * @param {string} b64
 * @returns {string}
 */
function wrapBase64Lines(b64) {
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) {
    lines.push(b64.slice(i, i + 76));
  }
  return lines.join('\r\n');
}

/**
 * Build a base64url-encoded RFC 2822 email message for Gmail `POST /messages/send` or `/drafts`.
 * @param {{ to?: string, cc?: string, subject?: string, body?: string, inReplyTo?: string, references?: string }} params
 * @returns {string}
 */
export function buildRawEmailMessage({
  to = '',
  cc = '',
  subject = '',
  body = '',
  inReplyTo = '',
  references = ''
}) {
  const cleanTo = sanitizeHeaderValue(to);
  const cleanCc = sanitizeHeaderValue(cc);
  const cleanSubject = sanitizeHeaderValue(subject);
  const cleanInReplyTo = sanitizeHeaderValue(inReplyTo);
  const cleanRefs = sanitizeHeaderValue(references);

  let mergedRefs = cleanRefs;
  if (cleanInReplyTo) {
    if (!mergedRefs) {
      mergedRefs = cleanInReplyTo;
    } else if (!mergedRefs.includes(cleanInReplyTo)) {
      mergedRefs = `${mergedRefs} ${cleanInReplyTo}`;
    }
  }

  const headers = [];
  if (cleanTo) {
    headers.push(`To: ${cleanTo}`);
  }
  if (cleanCc) {
    headers.push(`Cc: ${cleanCc}`);
  }
  headers.push(`Subject: ${encodeRfc2047(cleanSubject)}`);

  if (cleanInReplyTo) {
    headers.push(`In-Reply-To: ${cleanInReplyTo}`);
  }
  if (mergedRefs) {
    headers.push(`References: ${mergedRefs}`);
  }

  headers.push(
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64'
  );

  const normalizedBody = String(body || '').replace(/\r?\n/g, '\r\n');
  const encodedBody = wrapBase64Lines(base64EncodeUtf8(normalizedBody));
  const mimeMessage = `${headers.join('\r\n')}\r\n\r\n${encodedBody}`;

  return base64UrlEncodeUtf8(mimeMessage);
}

/**
 * Build a base64url-encoded RFC 2822 reply message for Gmail `POST /messages/send`.
 * Automatically prefixes `Re: ` when absent and attaches threading headers.
 * @param {{ to: string, subject: string, body: string, inReplyTo?: string, references?: string }} params
 * @returns {string}
 */
export function buildRawReplyMessage({ to, subject, body, inReplyTo = '', references = '' }) {
  const rawSubject = sanitizeHeaderValue(subject) || '(no subject)';
  const replySubject = /^re:\s/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;
  return buildRawEmailMessage({
    to,
    subject: replySubject,
    body,
    inReplyTo,
    references
  });
}

/**
 * Format a `To` header (single or comma-separated) into a compact recipient summary.
 * @param {string} toHeader
 * @returns {string}
 */
export function formatRecipientsSummary(toHeader) {
  const raw = sanitizeHeaderValue(toHeader);
  if (!raw) return '(no recipients)';

  const parts = raw
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return '(no recipients)';
  const first = parseEmailAddress(parts[0]);
  const primary = first.name || first.email || '(no recipients)';
  return parts.length > 1 ? `${primary}, +${parts.length - 1}` : primary;
}

/**
 * Parse an email header like `"Jane Doe" <jane@example.com>` into `{ name, email }`.
 * @param {string} headerValue
 * @returns {{ name: string, email: string }}
 */
export function parseEmailAddress(headerValue) {
  const raw = sanitizeHeaderValue(headerValue);
  if (!raw) {
    return { name: 'Unknown sender', email: '' };
  }

  const angleMatch = raw.match(/^(.*?)\s*<([^<>]+)>\s*$/);
  if (angleMatch) {
    const email = angleMatch[2].trim();
    let name = angleMatch[1].trim();
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
      name = name.slice(1, -1).replace(/\\(["\\])/g, '$1').trim();
    }
    return {
      name: name || email,
      email
    };
  }

  const emailOnlyMatch = raw.match(/^<?([^\s<>@]+@[^\s<>@]+)>?$/);
  if (emailOnlyMatch) {
    const email = emailOnlyMatch[1].trim();
    const localPart = email.split('@')[0] || email;
    return { name: localPart, email };
  }

  return { name: raw, email: raw };
}

/**
 * Decode common HTML entities in plain text strings (e.g. Gmail snippets).
 * Safe to run inside a Service Worker without DOMParser.
 * @param {string} str
 * @returns {string}
 */
export function decodeHtmlEntitiesPlain(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const cp = Number.parseInt(entity.slice(2), 16);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) {
        return String.fromCodePoint(cp);
      }
      return full;
    }
    if (entity.startsWith('#')) {
      const cp = Number.parseInt(entity.slice(1), 10);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) {
        return String.fromCodePoint(cp);
      }
      return full;
    }
    return NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? full;
  });
}

/**
 * Format timestamp into a compact relative time label.
 * @param {number} timestampMs
 * @returns {string}
 */
export function formatRelativeTime(timestampMs) {
  const ts = Number(timestampMs);
  if (!Number.isFinite(ts) || ts <= 0) return '';

  const date = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;

  if (ts >= startOfToday) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (ts >= startOfYesterday) {
    return 'Yesterday';
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

/**
 * Format timestamp into a full readable date-time string.
 * @param {number} timestampMs
 * @returns {string}
 */
export function formatFullDate(timestampMs) {
  const ts = Number(timestampMs);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * Extract 1-2 uppercase initials from a sender name or email address.
 * @param {string} name
 * @param {string} email
 * @returns {string}
 */
export function getInitials(name, email = '') {
  const source = (name || email || '?').trim();
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase() || '?';
}

/**
 * Case-insensitive header lookup on Gmail `payload.headers`.
 * @param {Array<{ name?: string, value?: string }>} headers
 * @param {string} targetName
 * @returns {string}
 */
export function getHeader(headers, targetName) {
  if (!Array.isArray(headers) || !targetName) return '';
  const lower = targetName.toLowerCase();
  const match = headers.find((h) => h && typeof h.name === 'string' && h.name.toLowerCase() === lower);
  return match?.value || '';
}

/**
 * Recursively extract `text/plain` and `text/html` bodies from a Gmail MIME payload.
 * @param {object} payload
 * @returns {{ textPlain: string, textHtml: string }}
 */
export function extractMimeBodies(payload) {
  let textPlain = '';
  let textHtml = '';

  function walk(part) {
    if (!part || typeof part !== 'object') return;
    const mimeType = (part.mimeType || '').toLowerCase();
    const isAttachment = Boolean(part.filename) && getHeader(part.headers, 'Content-Disposition').toLowerCase().startsWith('attachment');

    if (!isAttachment && part.body?.data) {
      const decoded = base64UrlDecodeUtf8(part.body.data);
      if (mimeType === 'text/plain' && !textPlain) {
        textPlain = decoded;
      } else if (mimeType === 'text/html' && !textHtml) {
        textHtml = decoded;
      }
    }

    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  }

  walk(payload);
  return { textPlain, textHtml };
}
