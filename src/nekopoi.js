// NekoPoi scraper (https://nekopoi.care) — WordPress site.
// Content: video post listings (home/category), detail posts with iframe players.
// Parses raw HTML. No auth required.

import { getCache, setCache } from './cache.js';
import { safeHttpUrl, stripHtml } from './security.js';

const DEFAULT_BASE_URL = 'https://nekopoi.care';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const state = {
  baseUrl: process.env.NEKO_BASE_URL || DEFAULT_BASE_URL,
  userAgent: process.env.NEKO_USER_AGENT || DEFAULT_USER_AGENT,
  timeoutMs: Number(process.env.NEKO_TIMEOUT_MS) || 30000,
  cacheTtl: 600,
};

/**
 * Override runtime configuration for the NekoPoi source.
 * @param {{baseUrl?: string, userAgent?: string, timeoutMs?: number}} opts
 */
export function configureNeko(opts = {}) {
  if (opts.baseUrl !== undefined) state.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  if (opts.userAgent !== undefined) state.userAgent = opts.userAgent;
  if (opts.timeoutMs !== undefined) state.timeoutMs = opts.timeoutMs;
  if (opts.cacheTtl !== undefined) state.cacheTtl = opts.cacheTtl;
}

// Only embed players from these hosts are allowed in <iframe>.
const ALLOWED_PLAYER_HOSTS = [
  'playmogo.com',
  'streampoi.com',
  'yandex.ru',
  'ok.ru',
  'doodstream.com',
  'dood.re',
  'streamtape.com',
  'mega.nz',
];

async function getHtml(path) {
  const res = await fetch(`${state.baseUrl}${path}`, {
    headers: {
      'User-Agent': state.userAgent,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(state.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.text();
}

// Decode basic HTML entities
function decodeEntities(s) {
  return s
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Parse post card list from HTML
// Home: <div class="nk-post-card">...<h2><a href="...">title</a></h2>
// Category: <a class="nk-search-item"><div class="nk-search-thumb" style="background-image:url('...')">...<h2>title</h2><p class="nk-search-desc">
function parseCards(html) {
  const cards = [];
  const push = (url, rawTitle, thumb, desc) => {
    const title = decodeEntities(stripHtml(rawTitle));
    if (!url || !title) return;
    // Only internal nekopoi links become cards (prevent external/abusive links)
    const cleanUrl = safeHttpUrl(url);
    if (!cleanUrl.startsWith(state.baseUrl)) return;
    cards.push({
      title,
      slug: cleanUrl.split('/').filter(Boolean).pop() || '',
      url: cleanUrl,
      thumb: safeHttpUrl(thumb.startsWith('http') ? thumb : `https:${thumb}`),
      date: '',
      synopsis: desc ? decodeEntities(stripHtml(desc)) : '',
    });
  };

  // Format 1: nk-post-card (home)
  const parts = html.split('class="nk-post-card"');
  for (let i = 1; i < parts.length; i++) {
    const blk = parts[i];
    const linkMatch = blk.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    const thumbMatch = blk.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/);
    const dateMatch = blk.match(/Minggu|Senin|Selasa|Rabu|Kamis|Jumat|Sabtu[^<]*/);
    push(linkMatch[1], linkMatch[2], thumbMatch ? thumbMatch[1] : '', '');
    if (dateMatch) cards[cards.length - 1].date = dateMatch[0].trim();
  }

  // Format 2: nk-search-item (category/list) — href is on the <a> opening tag
  const itemRe = /<a href="([^"]+)" class="nk-search-item">([\s\S]*?)<\/a>/g;
  let im;
  while ((im = itemRe.exec(html)) !== null) {
    const blk = im[2];
    const thumbMatch = blk.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/);
    const titleMatch = blk.match(/<h2>([\s\S]*?)<\/h2>/);
    const descMatch = blk.match(/<p[^>]*class="nk-search-desc"[^>]*>([\s\S]*?)<\/p>/);
    push(
      im[1],
      titleMatch ? titleMatch[1] : '',
      thumbMatch ? thumbMatch[1] : '',
      descMatch ? descMatch[1] : ''
    );
  }

  return cards;
}

/**
 * Fetch the latest video listings.
 * @param {number} [page=1] - page number (1 = home)
 * @returns {Promise<{videos: Array, hasNext: boolean}>}
 */
export async function scrapeNekoList(page = 1) {
  const path = page <= 1 ? '/' : `/page/${page}/`;
  const html = await getHtml(path);
  const videos = parseCards(html);
  const hasNext = html.includes(`/page/${page + 1}/`);
  return { videos, hasNext };
}

/**
 * Fetch videos by category (e.g. hentai, jav, 2d-animation).
 * @param {string} category - category slug
 * @param {number} [page=1]
 * @returns {Promise<{videos: Array, hasNext: boolean}>}
 */
export async function scrapeNekoCategory(category, page = 1) {
  const path = page <= 1 ? `/category/${category}/` : `/category/${category}/page/${page}/`;
  const html = await getHtml(path);
  return { videos: parseCards(html), hasNext: html.includes(`/page/${page + 1}/`) };
}

/**
 * Fetch available categories from the category-list page.
 * @returns {Promise<Array<{slug: string, name: string}>>}
 */
export async function scrapeNekoCategories() {
  try {
    const html = await getHtml('/hentai-list/');
    const cats = [];
    const re = /href="https?:\/\/nekopoi\.care\/category\/([^"/]+)\/"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (!cats.some((c) => c.slug === m[1])) cats.push({ slug: m[1], name: m[1].replace(/-/g, ' ') });
    }
    return cats;
  } catch {
    return [];
  }
}

/**
 * Fetch full detail of a video post: title, thumbnail, iframe players, synopsis.
 * @param {string} slug
 * @returns {Promise<{title: string, slug: string, thumb: string, players: string[], synopsis: string}>}
 */
export async function scrapeNekoDetail(slug) {
  const cacheKey = `neko-detail-${slug}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const html = await getHtml(`/${slug}/`);
  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch
    ? decodeEntities(stripHtml(titleMatch[1].replace(/&#8211;.*$/, '')))
    : slug;

  // Thumbnail: og:image or featured image
  const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  const thumb = safeHttpUrl(ogMatch ? ogMatch[1] : '');

  // Player: only iframes from known hosts — ads/tracking are discarded
  const players = [];
  const iframeSrcRe = /<iframe[^>]*src="([^"]+)"[^>]*>/g;
  let m;
  while ((m = iframeSrcRe.exec(html)) !== null) {
    const raw = m[1].startsWith('http') ? m[1] : `https:${m[1]}`;
    const clean = safeHttpUrl(raw);
    if (!clean) continue;
    let host;
    try {
      host = new URL(clean).hostname;
    } catch {
      continue;
    }
    // Skip ad/tracking/application iframes (not video players)
    if (/a-ads|doubleclick|googlesyndication|discord|facebook|twitter|instagram/.test(host)) continue;
    if (ALLOWED_PLAYER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      players.push(clean);
    }
  }

  // Synopsis: approximate paragraph after content
  const synopsisMatch = html.match(/<p>([\s\S]{40,600}?)<\/p>/);
  const synopsis = synopsisMatch ? decodeEntities(stripHtml(synopsisMatch[1])) : '';

  const detail = { title, slug, thumb, players, synopsis };
  setCache(cacheKey, detail, state.cacheTtl);
  return detail;
}

/**
 * Fetch available genres from the genre-list page.
 * @returns {Promise<Array<{slug: string, name: string}>>}
 */
export async function scrapeNekoGenres() {
  try {
    const html = await getHtml('/genre-list/');
    const genres = [];
    const re = /<a\s+[^>]*href="https?:\/\/nekopoi\.care\/genres\/([^"/]+)\/"[^>]*>([^<]+)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const slug = m[1];
      const name = decodeEntities(stripHtml(m[2])).trim();
      if (!genres.some((g) => g.slug === slug)) genres.push({ slug, name });
    }
    return genres;
  } catch {
    return [];
  }
}

/**
 * Fetch videos from a genre page.
 * @param {string} slug - genre slug
 * @param {number} [page=1]
 * @returns {Promise<{videos: Array, hasNext: boolean}>}
 */
export async function scrapeNekoGenre(slug, page = 1) {
  const path = page <= 1 ? `/genres/${slug}/` : `/genres/${slug}/page/${page}/`;
  const html = await getHtml(path);
  const videos = parseCards(html);
  const hasNext = html.includes(`/genres/${slug}/page/${page + 1}/`);
  return { videos, hasNext };
}

/**
 * Related/recommended videos (YouTube-style) for a watch page.
 *  1. Post with the same root slug (other episodes of the same title) — priority
 *  2. Remaining are shuffled from recent pages + random pages
 *  Excludes the current slug. TTL is short (120s) so the list feels fresh on each refresh.
 * @param {string} slug - current video slug
 * @param {{limit?: number}} [opts]
 * @returns {Promise<Array<{slug: string, title: string, thumb: string, url: string, synopsis: string, sameSeries: boolean}>>}
 */
export async function scrapeNekoRelated(slug, { limit = 12 } = {}) {
  const cacheKey = `neko-related-${slug}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  // Root title: strip episode/varian markers from slug
  const stem = slug
    .replace(/-episode-\d+.*$/i, '')
    .replace(/-subtitle-indonesia$/i, '')
    .replace(/-(sub|indonesia|uncensored|censored)$/i, '');

  const pages = [1, 2, 3, Math.floor(Math.random() * 9) + 2];
  const seen = new Set();
  const items = [];
  for (const page of pages) {
    try {
      const { videos } = await scrapeNekoList(page);
      for (const v of videos) {
        if (v.slug === slug || seen.has(v.slug)) continue;
        seen.add(v.slug);
        items.push({
          slug: v.slug,
          title: v.title,
          thumb: v.thumb,
          url: v.url,
          synopsis: v.synopsis,
          sameSeries: v.slug.startsWith(stem) && stem.length >= 8,
        });
      }
    } catch {
      // skip failed pages
    }
  }

  // Same series first, then shuffle
  const sameSeries = items.filter((v) => v.sameSeries);
  const others = items.filter((v) => !v.sameSeries);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }

  const result = [...sameSeries, ...others].slice(0, limit);
  setCache(cacheKey, result, 120);
  return result;
}

/**
 * Fetch a random post slug (for a "shuffle" button).
 * @returns {Promise<string>} slug or empty string
 */
export async function scrapeNekoRandomSlug() {
  const page = Math.floor(Math.random() * 9) + 1;
  try {
    const { videos } = await scrapeNekoList(page);
    return videos.length ? videos[Math.floor(Math.random() * videos.length)].slug : '';
  } catch {
    return '';
  }
}