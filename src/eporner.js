// Eporner scraper (https://www.eporner.com/) — tube video site.
// Uses the official public JSON API (https://www.eporner.com/api/) — no login,
// no API key, no Cloudflare challenge. HTML parsing used for categories,
// top-rated/most-viewed listings, and mp4 source fallback.
//
// Endpoints:
//   - List/search : GET https://api.eporner.com/api/v2/video/search/?query=...&per_page=28&page=N&format=json&thumbsize=medium
//   - Detail      : GET https://api.eporner.com/api/v2/video/id?id=<id>&format=json
//                   (REQUIRES Referer: https://www.eporner.com/ — without it the API returns [])

import { getCache, setCache } from './cache.js';
import { safeHttpUrl } from './security.js';

const DEFAULT_API_BASE = 'https://api.eporner.com/api/v2';
const DEFAULT_HTML_BASE = 'https://www.eporner.com';
const REFERER = 'https://www.eporner.com/';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const state = {
  apiBase: process.env.EPORNER_API_BASE || DEFAULT_API_BASE,
  htmlBase: process.env.EPORNER_BASE_URL || DEFAULT_HTML_BASE,
  userAgent: process.env.EPORNER_USER_AGENT || DEFAULT_USER_AGENT,
  timeoutMs: Number(process.env.EPORNER_TIMEOUT_MS) || 30000,
  cacheTtl: 600,
};

/**
 * Override runtime configuration for the Eporner source.
 * @param {{apiBase?: string, htmlBase?: string, userAgent?: string, timeoutMs?: number}} opts
 */
export function configureEporner(opts = {}) {
  if (opts.apiBase !== undefined) state.apiBase = opts.apiBase.replace(/\/+$/, '');
  if (opts.htmlBase !== undefined) state.htmlBase = opts.htmlBase.replace(/\/+$/, '');
  if (opts.userAgent !== undefined) state.userAgent = opts.userAgent;
  if (opts.timeoutMs !== undefined) state.timeoutMs = opts.timeoutMs;
  if (opts.cacheTtl !== undefined) state.cacheTtl = opts.cacheTtl;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': state.userAgent,
      Accept: 'application/json',
      Referer: REFERER,
    },
    signal: AbortSignal.timeout(state.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getHtmlText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': state.userAgent,
      Accept: 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: REFERER,
    },
    signal: AbortSignal.timeout(state.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ── Map API video → consistent card shape ────────────────────────────────

function mapVideo(v) {
  const thumb = v.default_thumb?.src || (Array.isArray(v.thumbs) && v.thumbs[0]?.src) || '';
  const tags = typeof v.keywords === 'string'
    ? v.keywords.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  return {
    id: v.id,
    slug: v.id,
    title: v.title || 'Untitled',
    thumb: safeHttpUrl(thumb),
    duration: v.length_min || '',
    durationSec: v.length_sec || 0,
    views: v.views ?? 0,
    rate: v.rate || '',
    added: v.added || '',
    tags,
    url: safeHttpUrl(v.url),
    source: 'eporner',
  };
}

// ── List / Search / Detail ────────────────────────────────────────────────

/**
 * Fetch latest videos or search results. Empty query = latest.
 * @param {{page?: number, query?: string, order?: string}} [opts] - order: 'top-rated' (most-viewed is NOT supported by the API)
 * @returns {Promise<{videos: Array, hasNext: boolean, total: number}>}
 */
export async function scrapeEpornerList({ page = 1, query = '', order = '' } = {}) {
  const cacheKey = `eporner-list-${page}-${query.trim().toLowerCase()}-${order}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    per_page: '28',
    page: String(Math.max(1, page)),
    format: 'json',
    thumbsize: 'medium',
  });
  if (query) params.set('query', query);
  if (order) params.set('order', order);

  const data = await getJson(`${state.apiBase}/video/search/?${params}`);
  const videos = (data.videos || []).map(mapVideo);
  const pages = data.total_pages || 1;

  const result = { videos, hasNext: page < pages, total: data.total_count || 0 };
  setCache(cacheKey, result, state.cacheTtl);
  return result;
}

/**
 * Fetch video detail: embed player iframe + direct mp4 files (src).
 * @param {string} id
 * @returns {Promise<object>} normalized video detail (includes src[], embedUrl)
 */
export async function scrapeEpornerDetail(id) {
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(id || '')) throw new Error('Invalid id');

  const cacheKey = `eporner-detail-${id}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const data = await getJson(`${state.apiBase}/video/id?id=${encodeURIComponent(id)}&format=json`);
  // Detail response = video object at top level (not {video: {...}})
  const v = data.video || data;
  if (!v || !v.id) throw new Error(`Video ${id} not found`);

  // src is not always present in the API response — fallback to scraping
  // /dload/<id>/<quality>/ links from the video HTML page.
  let src = [];
  if (v.src && typeof v.src === 'object') {
    src = Object.entries(v.src)
      .map(([label, url]) => ({ label, url: safeHttpUrl(url) }))
      .filter((s) => s.url);
  }
  if (src.length === 0) {
    src = await scrapeEpornerSources(id);
  }

  const detail = {
    ...mapVideo(v),
    embedUrl: safeHttpUrl(v.embed?.embed_url || `${state.htmlBase}/embed/${id}/`),
    embedThumb: safeHttpUrl(v.embed?.thumb || ''),
    src,
    description: v.description || '',
  };
  setCache(cacheKey, detail, state.cacheTtl);
  return detail;
}

/**
 * Fetch the mp4 file list per quality from the video page.
 * The page has a #downloaddiv with /dload/<id>/<quality>/<imgid>-<quality>p.mp4
 * links (240/360/480/720/1080p). These links 302 → a signed CDN that supports
 * range requests, so they can be used directly in <video src>.
 * @returns {Promise<Array<{label: string, url: string}>>} sorted by quality DESC
 */
async function scrapeEpornerSources(id) {
  try {
    const html = await getHtmlText(`${state.htmlBase}/video-${id}/`);
    const found = [];
    const re = /\/dload\/[A-Za-z0-9_-]+\/(\d{3,4})\/[^"]+\.mp4/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const label = `${m[1]}p`;
      const url = `${state.htmlBase}${m[0]}`;
      if (!found.some((s) => s.label === label)) found.push({ label, url });
    }
    const num = (label) => parseInt(label, 10) || 0;
    found.sort((a, b) => num(b.label) - num(a.label));
    return found;
  } catch {
    return [];
  }
}

// ── Categories & listings (HTML) ──────────────────────────────────────────

/**
 * Fetch available categories from /cats/.
 * @returns {Promise<Array<{slug: string, name: string}>>}
 */
export async function scrapeEpornerCategories() {
  try {
    const html = await getHtmlText(`${state.htmlBase}/cats/`);
    const cats = [];
    const re = /href="\/cat\/([^"/]+)\/"\s*title="([^"]*)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const slug = m[1];
      if (slug === 'all') continue; // 'all' is not a real category
      if (!cats.some((c) => c.slug === slug)) {
        cats.push({ slug, name: m[2] || slug.replace(/-/g, ' ') });
      }
    }
    return cats;
  } catch {
    return [];
  }
}

/**
 * Fetch videos from a category page.
 * @param {string} slug - category slug
 * @param {number} [page=1]
 * @returns {Promise<{videos: Array, hasNext: boolean}>}
 */
export async function scrapeEpornerCategory(slug, page = 1) {
  const path = page <= 1 ? `/cat/${slug}/` : `/cat/${slug}/${page}/`;
  const html = await getHtmlText(`${state.htmlBase}${path}`);
  return parseEpornerListing(html);
}

/**
 * Fetch videos from a special listing page.
 * @param {string} kind - 'top-rated' (popular) or 'most-viewed'
 * @param {number} [page=1]
 * @returns {Promise<{videos: Array, hasNext: boolean}>}
 */
export async function scrapeEpornerListingPage(kind, page = 1) {
  if (!['top-rated', 'most-viewed'].includes(kind)) throw new Error('Invalid kind');
  const cacheKey = `eporner-listing-${kind}-${page}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const path = page <= 1 ? `/${kind}/` : `/${kind}/${page}/`;
  const html = await getHtmlText(`${state.htmlBase}${path}`);
  const result = parseEpornerListing(html);
  setCache(cacheKey, result, state.cacheTtl);
  return result;
}

/** Parse 'mb hdy' video blocks from an eporner listing HTML page. */
function parseEpornerListing(html) {
  const videos = [];
  const parts = html.split('class="mb hdy"');
  for (let i = 1; i < parts.length; i++) {
    const blk = parts[i];
    // ID from URL: /video-<id>/<slug-title>/
    const hrefMatch = blk.match(/href="\/(video-[^"/]+)\//);
    if (!hrefMatch) continue;
    const id = hrefMatch[1].replace(/^video-/, '');
    if (!id) continue;

    // Title from .mbtit block
    const titleMatch = blk.match(/<p class="mbtit">\s*<a[^>]*>([\s\S]*?)<\/a>/);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').trim()
      : id;

    // Thumbnail: data-src (lazy) or src; discard data: placeholders
    const imgMatch = blk.match(/<img[^>]*>/);
    let thumb = '';
    if (imgMatch) {
      const imgTag = imgMatch[0];
      const dataSrc = imgTag.match(/data-src="([^"]+)"/);
      const src = imgTag.match(/src="([^"]+)"/);
      const raw = dataSrc ? dataSrc[1] : src ? src[1] : '';
      if (raw && !raw.startsWith('data:')) thumb = safeHttpUrl(raw);
    }

    const durMatch = blk.match(/<span class="mbtim"[^>]*>([^<]+)<\/span>/);
    const duration = durMatch ? durMatch[1].trim() : '';

    const viewsMatch = blk.match(/<span class="mbvie"[^>]*>([^<]+)<\/span>/);
    const views = viewsMatch ? parseFloat(viewsMatch[1].replace(/,/g, '')) || 0 : 0;

    videos.push({ id, slug: id, title, thumb, duration, source: 'eporner', views });
  }

  // Eporner puts rel="next" in <head> when a next page exists
  const hasNext = /rel="next"/.test(html);
  return { videos, hasNext };
}

// ── Related / Random ──────────────────────────────────────────────────────

/**
 * Related/recommended videos (YouTube-style) for a watch page.
 *  1. Search results per tag/keyword from the title — priority
 *  2. Remaining shuffled from recent + random pages
 *  Excludes the current id. TTL short (120s) for freshness.
 * @param {string} id
 * @param {{tags?: string[], title?: string, limit?: number}} [opts]
 * @returns {Promise<Array<{id: string, title: string, thumb: string, duration: string, url: string, views: number, meta: string}>>}
 */
export async function scrapeEpornerRelated(id, { tags = [], title = '', limit = 12 } = {}) {
  const cacheKey = `eporner-related-${id}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const seen = new Set([id]);
  const items = [];

  // 1. Search per tag (max 2) — most relevant
  const queryTags = tags.filter(Boolean).slice(0, 2);
  for (const tag of queryTags) {
    try {
      const { videos } = await scrapeEpornerList({ page: 1, query: tag });
      for (const v of videos) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        items.push({ ...v, score: 50 });
      }
    } catch {
      // skip
    }
    if (items.length >= limit) break;
  }

  // 2. Keyword from title + recent/random pages
  if (items.length < limit) {
    const kw = (title || '').split(/\s+/).find((w) => w.length > 4) || '';
    const extraQueries = [kw].filter(Boolean);
    for (const q of [...extraQueries, '', '']) {
      const page = q ? 1 : [1, 2, Math.floor(Math.random() * 9) + 2][items.length % 3];
      try {
        const { videos } = await scrapeEpornerList({ page, query: q });
        for (const v of videos) {
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          items.push({ ...v, score: q ? 30 : Math.random() * 10 });
        }
      } catch {
        // skip
      }
      if (items.length >= limit) break;
    }
  }

  const tagged = items.filter((v) => v.score >= 30);
  const rest = items.filter((v) => v.score < 30);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const pool = [...tagged, ...rest];
  const result = pool.slice(0, limit).map((v) => ({
    id: v.id,
    title: v.title,
    thumb: v.thumb,
    duration: v.duration,
    url: `${state.htmlBase}/video-${v.id}/`,
    views: v.views,
    meta: `${fmtViews(v.views)} views`,
  }));

  setCache(cacheKey, result, 120);
  return result;
}

/**
 * Fetch a random video id (for a "shuffle" button).
 * @returns {Promise<string>} id or empty string
 */
export async function scrapeEpornerRandomId() {
  const page = Math.floor(Math.random() * 9) + 1;
  try {
    const { videos } = await scrapeEpornerList({ page });
    return videos.length ? videos[Math.floor(Math.random() * videos.length)].id : '';
  } catch {
    return '';
  }
}

function fmtViews(n) {
  if (!n) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
