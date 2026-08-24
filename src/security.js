// Shared security utilities: external-URL validation (anti-SSRF), HTML/URL
// sanitization. Everything a scraper returns that originated from a third
// party should pass through these before being rendered by your UI.

const PRIVATE_IP_RE =
  /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d)|198\.18\.|198\.19\.)/;
const IPV6_PRIVATE_RE =
  /^(::1$|::|fe80:|fc00:|fd00:|fec0:|2001:db8:|::ffff:)/i;
const LOCAL_HOSTNAMES = new Set([
  'localhost',
  'local',
  'metadata.google.internal',
  'metadata',
]);

function looksLikeIp(hostname) {
  const cleaned = hostname.replace(/^\[|\]$/g, '');
  // IPv6 literal
  if (cleaned.includes(':')) {
    return IPV6_PRIVATE_RE.test(cleaned);
  }
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned)) {
    return PRIVATE_IP_RE.test(cleaned) || cleaned === '0.0.0.0';
  }
  return false;
}

/**
 * Reject URLs pointing to internal resources (SSRF protection): local
 * hostnames, private/loopback/link-local IPs, or DNS resolutions to those
 * IPs. Non-standard ports (anything other than 80/443) are also rejected.
 *
 * Note: performs a DNS lookup via node:dns — only available in Node.js
 * runtimes (not browsers/edge workers).
 *
 * @param {string} rawUrl
 * @param {{allowPorts?: number[]}} [opts]
 * @returns {Promise<boolean>}
 */
export async function isSafeExternalUrl(rawUrl, { allowPorts = [80, 443] } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (!allowPorts.includes(Number(port))) return false;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (LOCAL_HOSTNAMES.has(hostname)) return false;
  if (looksLikeIp(hostname)) return false;

  // DNS rebinding protection: make sure the resolved address is not internal.
  try {
    const { lookup } = await import('node:dns/promises');
    const addresses = await lookup(hostname, { all: true });
    if (addresses.some((a) => looksLikeIp(a.address))) return false;
  } catch {
    // Resolution failed — let fetch handle the error downstream.
  }

  return true;
}

/** Strip javascript:, data:, vbscript: and similar dangerous schemes. */
export function sanitizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (/^\s*(javascript|data|vbscript):/i.test(trimmed)) return '';
  return trimmed;
}

/**
 * Remove HTML tags and normalize whitespace — for text that originated from
 * an external source.
 * @param {string} raw
 * @returns {string}
 */
export function stripHtml(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Safe URL for href/src attributes — forces http/https only, returns '' for
 * anything else (javascript:, data:, vbscript:, relative paths, garbage).
 * @param {string} rawUrl
 * @returns {string}
 */
export function safeHttpUrl(rawUrl) {
  const cleaned = sanitizeUrl(rawUrl);
  if (!cleaned) return '';
  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}
