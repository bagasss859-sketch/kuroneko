// Hentai.tv scraper (https://hentai.tv/) — hentai 2D streaming site.
// Has a public JSON API (Next.js): GET /api/browse — no auth, no Cloudflare.
// Also parses RSC payloads from HTML pages for genre/series/trending data.
//
// Endpoints:
//   - List      : GET /api/browse?page=N          (28 videos/page)
//   - Search    : GET /api/browse?search=<q>
//   - Detail    : GET /hentai/<slug>                (HTML + JSON-LD)
//   - Genre     : GET /genre/<slug>                 (HTML + RSC payload)
//   - Series    : GET /series/                      (HTML)
//   - Trending  : GET /trending                     (HTML + RSC payload)
//   - Random    : GET /random                        (307 redirect → /hentai/<slug>)

import { getCache, setCache } from './cache.js';
import { safeHttpUrl, stripHtml } from './security.js';

const DEFAULT_BASE_URL = 'https://hentai.tv';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const state = {
  baseUrl: process.env.HENTAI_BASE_URL || DEFAULT_BASE_URL,
  userAgent: process.env.HENTAI_USER_AGENT || DEFAULT_USER_AGENT,
  timeoutMs: Number(process.env.HENTAI_TIMEOUT_MS) || 30000,
  cacheTtl: 600,
};

/**
 * Override runtime configuration for the Hentai.tv source.
 * @param {{baseUrl?: string, userAgent?: string, timeoutMs?: number}} opts
 */
export function configureHentai(opts = {}) {
  if (opts.baseUrl !== undefined) state.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  if (opts.userAgent !== undefined) state.userAgent = opts.userAgent;
  if (opts.timeoutMs !== undefined) state.timeoutMs = opts.timeoutMs;
  if (opts.cacheTtl !== undefined) state.cacheTtl = opts.cacheTtl;
}

async function getJson(path) {
  const res = await fetch(`${state.baseUrl}${path}`, {
    headers: {
      'User-Agent': state.userAgent,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(state.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

async function getHtml(path) {
  const res = await fetch(`${state.baseUrl}${path}`, {
    headers: {
      'User-Agent': state.userAgent,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(state.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.text();
}

// ── Map API video → consistent card shape ─────────────────────────────────

function mapVideo(v) {
  const title = stripHtml(v.title || '').trim() || 'Untitled';
  const abs = (p) => (p && p.startsWith('http') ? safeHttpUrl(p) : p ? safeHttpUrl(`${state.baseUrl}${p}`) : '');
  const tags = Array.isArray(v.tags) ? v.tags.map(String) : [];

  return {
    id: v.id,
    slug: v.slug,
    title,
    displayTitle: v.ep ? `${title} EP ${v.ep}` : title,
    ep: v.ep || null,
    titleSlug: v.titleSlug || '',
    views: v.views ?? 0,
    likes: v.likes ?? 0,
    rating: v.rating ?? 0,
    censored: !!v.censored,
    brand: v.brand || '',
    quality: v.quality || '',
    year: v.year || '',
    language: v.language || '',
    duration: v.duration || '',
    tags,
    thumb: abs(v.cover || v.thumb || v.featureImage),
    backdrop: abs(v.backdrop),
    embedUrl: safeHttpUrl(v.embedUrl),
    description: stripHtml(v.description || '').trim(),
    releasedAt: v.releasedAt || '',
    source: 'hentaitv',
  };
}

// ── Browse / Search ───────────────────────────────────────────────────────

/**
 * Fetch video list (browse) or search results. Empty query = all.
 * @param {{page?: number, query?: string}} [opts]
 * @returns {Promise<{videos: Array, hasNext: boolean, total: number}>}
 */
export async function scrapeHentaiList({ page = 1, query = '' } = {}) {
  const cacheKey = `hentai-list-${page}-${query.trim().toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ page: String(Math.max(1, page)) });
  if (query) params.set('search', query);

  const data = await getJson(`/api/browse?${params}`);
  const videos = (data.videos || []).map(mapVideo);
  const pages = data.pages || 1;

  const result = { videos, hasNext: page < pages, total: data.total || 0 };
  setCache(cacheKey, result, state.cacheTtl);
  return result;
}

// ── Detail ────────────────────────────────────────────────────────────────

/**
 * Fetch video detail by slug.
 *
 * IMPORTANT: the /api/browse endpoint does NOT support reliable detail lookup
 * (?slug= is ignored, ?search= is full-text only so many slugs won't match).
 * The reliable approach is to fetch the HTML detail page `/hentai/<slug>`
 * which contains full JSON-LD (embedUrl, genre, description, views, duration)
 * + genre chips. Falls back to API search if the HTML page fails.
 *
 * @param {string} slug
 * @returns {Promise<object>} normalized video detail
 */
export async function scrapeHentaiDetail(slug) {
  if (!/^[a-z0-9-]{2,}$/.test(slug || '')) throw new Error('Invalid slug');

  const cacheKey = `hentai-detail-${slug}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  let html;
  try {
    html = await getHtml(`/hentai/${slug}`);
  } catch {
    // Fallback: API search (full-text) — only works if slug == title
    const data = await getJson(`/api/browse?search=${encodeURIComponent(slug)}`);
    const v = (data.videos || []).find((item) => item.slug === slug);
    if (!v) throw new Error(`Video ${slug} not found`);
    const detail = mapVideo(v);
    setCache(cacheKey, detail, state.cacheTtl);
    return detail;
  }

  const detail = parseHentaiDetailHtml(html, slug);
  if (!detail.embedUrl) throw new Error(`Video ${slug} has no player`);
  setCache(cacheKey, detail, state.cacheTtl);
  return detail;
}

/**
 * Parse JSON-LD VideoObject + genre chips from hentai.tv detail HTML.
 */
function parseHentaiDetailHtml(html, slug) {
  // JSON-LD VideoObject: { name, description, thumbnailUrl[], embedUrl,
  //   duration "PT24M48S", uploadDate, genre[], interactionStatistic.views }
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  let ld = null;
  for (const block of ldMatch) {
    try {
      const parsed = JSON.parse(block.replace(/<script[^>]*>|<\/script>/g, ''));
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const found = arr.find((x) => x && x['@type'] === 'VideoObject' && x.embedUrl);
      if (found) {
        ld = found;
        break;
      }
    } catch {
      // skip non-VideoObject blocks
    }
  }

  // ISO-8601 duration "PT24M48S" → "24:48"
  function fmtDuration(iso) {
    if (!iso) return '';
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return '';
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const sec = m[3] ? parseInt(m[3], 10) : 0;
    if (h > 0) return `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  // Title from <title> (cleaner than JSON-LD "Watch ... Online at Hentai.tv®")
  let title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
  title = stripHtml(title).trim();
  title = title.replace(/\s*-\s*(Watch.*)?Hentai\.tv.*$/i, '').replace(/\s+at\s+Hentai\.tv®?.*$/i, '').trim();
  title = title.replace(/^Watch\s+/i, '').replace(/\s+Online\s*$/i, '').trim();
  if (!title && ld) title = (ld.name || '').replace(/\s*-\s*Watch.*$/i, '').trim();

  // Episode: from slug "xxx-episode-N" → N, display title "XXX EP N"
  const epMatch = slug.match(/-episode-(\d+)$/);
  const ep = epMatch ? parseInt(epMatch[1], 10) : null;
  const titleSlug = slug.replace(/-episode-\d+$/, '');
  const titleHasEp = ep && new RegExp(`episode\\s*${ep}`, 'i').test(title);
  const displayTitle = ep && !titleHasEp ? `${title} EP ${ep}` : title;

  // Genre/tag chips: <a class="tag-chip" href="/genre/...">Name</a>
  const tags = [];
  const chipRe = /<a[^>]*class="tag-chip"[^>]*href="\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/g;
  let cm;
  while ((cm = chipRe.exec(html)) !== null) {
    const t = stripHtml(cm[1]).trim();
    if (t && !tags.includes(t)) tags.push(t);
  }
  // Fallback: genre from JSON-LD
  if (tags.length === 0 && ld && Array.isArray(ld.genre)) {
    for (const g of ld.genre) {
      const t = String(g).trim();
      if (t && !tags.includes(t)) tags.push(t);
    }
  }

  // Views from interactionStatistic
  let views = 0;
  try {
    const stat = ld && Array.isArray(ld.interactionStatistic)
      ? ld.interactionStatistic.find((s) => s && s['@type'] === 'InteractionCounter')
      : ld && ld.interactionStatistic;
    views = parseInt(stat && stat.userInteractionCount, 10) || 0;
  } catch {
    views = 0;
  }

  const yearMatch = html.match(/"year":(\d{4})/);
  const year = yearMatch ? yearMatch[1] : '';

  // Thumbnail: og:image is more reliable than JSON-LD thumbnailUrl
  const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  let thumb = ogMatch ? safeHttpUrl(ogMatch[1]) : '';
  if (!thumb && ld && Array.isArray(ld.thumbnailUrl) && ld.thumbnailUrl[0]) {
    thumb = safeHttpUrl(ld.thumbnailUrl[0]);
  }

  return {
    id: slug,
    slug,
    title,
    displayTitle,
    ep,
    titleSlug,
    views,
    likes: 0,
    rating: 0,
    censored: /censored/i.test(html),
    brand: '',
    quality: '',
    year,
    language: '',
    duration: ld ? fmtDuration(ld.duration) : '',
    tags: tags.slice(0, 20),
    thumb,
    backdrop: '',
    embedUrl: ld ? safeHttpUrl(ld.embedUrl) : '',
    description: ld ? stripHtml(ld.description || '').trim() : '',
    releasedAt: ld ? ld.uploadDate || '' : '',
    source: 'hentaitv',
  };
}

// ── Genre (from HTML pages, not API — API ignores genre filters) ─────────

// Unescape a single RSC payload chunk (JS string literal) → original string
function unescapeRscChunk(chunk) {
  try {
    return JSON.parse(`"${chunk}"`);
  } catch {
    return chunk.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }
}

// Join all RSC chunks into a single string
function joinRscPayload(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let joined = '';
  let m;
  while ((m = re.exec(html)) !== null) joined += unescapeRscChunk(m[1]);
  return joined;
}

// Extract a balanced JSON object from a string starting at `start`
function extractBalancedObject(str, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

// Strip global widget state from RSC payload (notifications, history, saved)
// These are rendered on ALL pages and would leak into genre/series results.
function stripGlobalWidgets(str) {
  for (const key of ['initialNotifications', 'initialSaved', 'initialHistory']) {
    const marker = `"${key}":[`;
    let idx = str.indexOf(marker);
    while (idx !== -1) {
      const start = idx + marker.length - 1;
      let depth = 0, inString = false, escaped = false, end = -1;
      for (let i = start; i < str.length; i++) {
        const ch = str[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '[') depth++;
        else if (ch === ']') {
          if (depth === 0) { end = i; break; }
          depth--;
        }
      }
      if (end === -1) break;
      str = str.slice(0, idx) + str.slice(end + 1);
      idx = str.indexOf(marker);
    }
  }
  return str;
}

// Parse RSC payload → list of video objects
function parseRscVideos(html) {
  const joined = stripGlobalWidgets(joinRscPayload(html));
  const videos = [];
  const seen = new Set();
  const patterns = [
    /{"id":"/g,
    /{"slug":"[a-z0-9-]+","title":"/g,
    /{"v":{"id":"/g, // trending page: {"v":{...video...}}
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(joined)) !== null && videos.length < 120) {
      const objStr = extractBalancedObject(joined, m.index);
      if (!objStr) break;
      try {
        const obj = JSON.parse(objStr);
        const actual = obj.v || obj; // unwrap {"v":{...}} wrapper
        if (actual && actual.slug && actual.title && actual.embedUrl && !seen.has(actual.slug)) {
          videos.push(actual);
          seen.add(actual.slug);
        }
      } catch {
        // skip invalid objects
      }
      re.lastIndex = m.index + 1;
    }
  }
  return videos;
}

/**
 * Fetch videos by genre (parsed from the actual genre page HTML).
 * @param {string} slug - genre slug
 * @param {number} [page=1]
 * @returns {Promise<{videos: Array, total: number, hasNext: boolean}>}
 */
export async function scrapeHentaiGenre(slug, page = 1) {
  if (!/^[a-z0-9-]{2,40}$/.test(slug || '')) throw new Error('Invalid genre');
  const cacheKey = `hentai-genre-${slug}-${page}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const path = page <= 1 ? `/genre/${slug}/` : `/genre/${slug}/?page=${page}`;
  const html = await getHtml(path);

  // Deduplicate — RSC may contain prefetched next-page videos
  const seen = new Set();
  const videos = parseRscVideos(html)
    .map(mapVideo)
    .filter((v) => {
      if (seen.has(v.slug)) return false;
      seen.add(v.slug);
      return true;
    });

  // Total titles: pattern "962<!-- --> titles" in RSC
  const totalMatch = html.match(/([0-9][0-9,]*)(?:<!-- -->)?\s*titles/i);
  const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) || 0 : videos.length;

  // 28 videos/page (same as /api/browse) — hasNext from total
  const hasNext = page < Math.ceil(total / 28);

  const result = { videos, total, hasNext };
  setCache(cacheKey, result, state.cacheTtl);
  return result;
}

/**
 * Fetch all available genres.
 * @returns {Promise<Array<{slug: string, name: string}>>}
 */
export async function scrapeHentaiGenres() {
  const cacheKey = 'hentai-genres';
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const html = await getHtml('/genres/');
  const genres = [];
  const re = /href="\/genre\/([a-z0-9-]+)\/?"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    if (!genres.some((g) => g.slug === slug)) {
      genres.push({ slug, name: slug.replace(/-/g, ' ') });
    }
  }

  setCache(cacheKey, genres, 3600);
  return genres;
}

/**
 * Fetch all series.
 * @returns {Promise<Array<{slug: string, name: string}>>}
 */
export async function scrapeHentaiSeries() {
  const cacheKey = 'hentai-series';
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const html = await getHtml('/series/');
  const series = [];
  const re = /href="\/series\/([a-z0-9-]+)\/?"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    if (!series.some((s) => s.slug === slug)) {
      series.push({ slug, name: slug.replace(/-/g, ' ') });
    }
  }

  setCache(cacheKey, series, 3600);
  return series;
}

/**
 * Fetch episodes of a series.
 * @param {string} slug - series slug
 * @returns {Promise<{videos: Array, totalEpisodes: number, title: string}>}
 */
export async function scrapeHentaiSeriesDetail(slug) {
  if (!/^[a-z0-9-]{2,}$/.test(slug || '')) throw new Error('Invalid series');
  const cacheKey = `hentai-series-detail-${slug}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const html = await getHtml(`/series/${slug}/`);
  const videos = parseRscVideos(html).map(mapVideo);

  const epMatch = html.match(/([0-9][0-9,]*)(?:<!-- -->)?\s*episodes/i);
  const totalEpisodes = epMatch ? parseInt(epMatch[1].replace(/,/g, ''), 10) || videos.length : videos.length;

  const result = { videos, totalEpisodes, title: slug.replace(/-/g, ' ') };
  setCache(cacheKey, result, state.cacheTtl);
  return result;
}

/**
 * Fetch a random video slug (follows the /random 307 redirect manually).
 * @returns {Promise<string>} slug or empty string
 */
export async function scrapeHentaiRandomSlug() {
  const res = await fetch(`${state.baseUrl}/random`, {
    headers: { 'User-Agent': state.userAgent, Accept: 'text/html' },
    redirect: 'manual',
    signal: AbortSignal.timeout(state.timeoutMs),
  });
  const location = res.headers.get('location') || '';
  const m = location.match(/\/hentai\/([a-z0-9-]+)/);
  return m ? m[1] : '';
}

/**
 * Trending videos from the /trending page.
 * TTL is longer (30min) because trending changes slowly.
 * @returns {Promise<{videos: Array, hasNext: boolean, total: number}>}
 */
export async function scrapeHentaiTrending() {
  const cacheKey = 'hentai-trending';
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const html = await getHtml('/trending');
  const seen = new Set();
  const videos = parseRscVideos(html)
    .map(mapVideo)
    .filter((v) => {
      if (seen.has(v.slug)) return false;
      seen.add(v.slug);
      return true;
    });

  const result = { videos, hasNext: false, total: videos.length };
  setCache(cacheKey, result, 1800);
  return result;
}

/**
 * Most viewed videos: hentai.tv has no sort-by-views page, so we aggregate
 * several /api/browse pages, deduplicate, sort by views DESC.
 * @returns {Promise<{videos: Array, hasNext: boolean, total: number}>}
 */
export async function scrapeHentaiMostViewed() {
  const cacheKey = 'hentai-most-viewed';
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const pages = [1, 2, 3, 5, 8, 13];
  const seen = new Set();
  const videos = [];
  await Promise.all(pages.map(async (p) => {
    try {
      const { videos: pageVideos } = await scrapeHentaiList({ page: p });
      for (const v of pageVideos) {
        if (seen.has(v.slug)) continue;
        seen.add(v.slug);
        videos.push(v);
      }
    } catch {
      // skip failed pages
    }
  }));

  videos.sort((a, b) => (b.views || 0) - (a.views || 0));

  const result = { videos: videos.slice(0, 60), hasNext: false, total: videos.length };
  setCache(cacheKey, result, 3600);
  return result;
}

/**
 * Related/recommended videos (YouTube-style) for a watch page.
 *  1. Other episodes of the same series (titleSlug match) — priority
 *  2. Shuffled from recent pages + random pages
 *  Excludes the current slug. TTL short (120s) for freshness.
 * @param {string} slug
 * @param {{limit?: number}} [opts]
 * @returns {Promise<Array<{slug: string, title: string, displayTitle: string, thumb: string, duration: string, url: string, views: number, meta: string}>>}
 */
export async function scrapeHentaiRelated(slug, { limit = 12 } = {}) {
  const cacheKey = `hentai-related-${slug}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const current = await scrapeHentaiDetail(slug);
  const titleSlug = current.titleSlug || slug.replace(/-episode-\d+$/, '');

  const pages = [1, 2, 3];
  pages.push(Math.floor(Math.random() * 39) + 2);
  pages.push(Math.floor(Math.random() * 39) + 2);
  const candidates = new Map();
  for (const page of pages) {
    try {
      const { videos } = await scrapeHentaiList({ page });
      for (const v of videos) {
        if (v.slug === slug || candidates.has(v.slug)) continue;
        candidates.set(v.slug, v);
      }
    } catch {
      // skip
    }
  }

  const rest = [...candidates.values()];
  const sameSeries = rest.filter((v) => v.titleSlug && v.titleSlug === titleSlug);
  const others = rest.filter((v) => !(v.titleSlug && v.titleSlug === titleSlug));
  shuffle(others);

  const result = sameSeries.concat(others).slice(0, limit).map((v) => ({
    slug: v.slug,
    title: v.title,
    displayTitle: v.displayTitle || v.title,
    thumb: v.thumb,
    duration: v.duration,
    url: `${state.baseUrl}/hentai/${v.slug}`,
    views: v.views,
    meta: v.titleSlug === titleSlug ? 'Series' : `${fmtViews(v.views)} views`,
  }));

  setCache(cacheKey, result, 120);
  return result;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fmtViews(n) {
  if (!n) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}