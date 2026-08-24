// External feed scrapers — blog/RSS aggregators that surface game releases.
// WordPress REST (collectionsof18), Wix RSS (DA Ports), and a WordPress
// blog + forum-link crawler (KoGa3). All scrape WITHOUT login or cookies.
// Self-contained — no dependency on other modules.

export function decodeXml(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#38;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

/** Browser-mirroring fetch → { html?, error? }. Never throws. */
async function httpFetch(url, timeoutMs = 25000) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'application/json,text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { html: await res.text() };
  } catch (e) {
    const err = e;
    return { error: err?.name === 'TimeoutError' ? 'timeout' : err?.message || String(e) };
  }
}

async function jsonFetch(url) {
  const r = await httpFetch(url, 25000);
  if (r.error || !r.html) throw new Error(`${url}: ${r.error ?? 'empty'}`);
  try {
    return JSON.parse(r.html);
  } catch {
    throw new Error(`${url}: not JSON (${r.html.length}b)`);
  }
}

/* ---------------- Collectionsof18 (WordPress REST API) ---------------- */

export async function scrapeCollectionsof18(page = 1, perPage = 100) {
  const url = `https://collectionsof18.com/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&_embed`;
  const j = await jsonFetch(url);
  return j.map((p) => {
    const embedded = p._embedded;
    const mediaArr = embedded?.['wp:featuredmedia'];
    const media = mediaArr?.[0]?.source_url;
    return {
      id: p.id,
      title: String(p.title?.rendered ?? p.title ?? 'Untitled').trim(),
      link: String(p.link ?? ''),
      date: String(p.date ?? ''),
      media: typeof media === 'string' ? media : null,
    };
  });
}

export function c18ToExternal(items) {
  return items
    .filter((i) => i.link && i.title)
    .map((i) => ({
      source: 'collectionsof18',
      title: i.title,
      cover: i.media,
      url: i.link,
      meta: { date: i.date, id: i.id },
    }));
}

/* ---------------- DA Ports (Wix blog RSS) ---------------- */

export async function scrapeDaports() {
  const r = await httpFetch('https://darkassassinda.wixsite.com/daports/blog-feed.xml', 25000);
  if (r.error || !r.html) throw new Error('blog-feed.xml: ' + (r.error ?? 'empty'));
  const xml = r.html;
  const out = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const pick = (tag) => {
      const mm = block.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)</${tag}>`));
      return mm ? decodeXml(mm[1]) : '';
    };
    out.push({
      title: pick('title').trim(),
      link: pick('link').trim(),
      date: pick('pubDate').trim(),
      description: pick('description').trim().slice(0, 500),
    });
  }
  return out;
}

export function daportsToExternal(items) {
  return items
    .filter((i) => i.link && i.title)
    .map((i) => ({
      source: 'daports',
      title: i.title,
      cover: null,
      url: i.link.startsWith('http') ? i.link : 'https://darkassassinda.wixsite.com' + i.link,
      meta: { date: i.date, description: i.description },
    }));
}

/* ---------------- KoGa3 (WordPress blog + forum links) ---------------- */

const KOGA_PAGES = [
  'https://koga3.bplaced.net/',
  'https://koga3.bplaced.net/game-reviews/',
  'https://koga3.bplaced.net/game-mods/',
  'https://koga3.bplaced.net/list-of-played-games/',
  'https://koga3.bplaced.net/game-music-tracks/',
];

export async function scrapeKoga3() {
  const seen = new Map();
  const NOISE = /(\/feed\/|\/wp-json\/|\/xmlrpc|\/page\/\d+|\/tag\/|\/category\/|\/comments\/|\/feed$)/i;
  for (const page of KOGA_PAGES) {
    const r = await httpFetch(page, 25000);
    if (r.error || !r.html) continue;
    const html = r.html;
    const forumLinks = new Set();
    const forumRe = /https:\/\/f95zone\.to\/threads\/[a-z0-9\-]+\.[0-9]+/gi;
    let m;
    while ((m = forumRe.exec(html))) forumLinks.add(m[0]);

    const postRe = /href="(https:\/\/koga3\.bplaced\.net\/[a-z0-9\-]+\/)"/g;
    let assigned = false;
    while ((m = postRe.exec(html))) {
      const url = m[1];
      if (NOISE.test(url)) continue;
      const slug = url.replace(/\/$/, '').split('/').pop() || url;
      if (!seen.has(url)) {
        seen.set(url, {
          title: slug.replace(/-/g, ' '),
          url,
          f95Link: !assigned && forumLinks.size > 0 ? [...forumLinks][0] : null,
          date: null,
        });
        if (!assigned && forumLinks.size > 0) assigned = true;
      }
    }
  }
  return [...seen.values()];
}

export function kogaToExternal(items) {
  return items.map((i) => ({
    source: 'koga3',
    title: i.title,
    cover: null,
    url: i.url,
    meta: { f95_url: i.f95Link, date: i.date },
  }));
}
