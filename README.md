# kuroneko

Zero-dependency scraping modules for media cataloging — manga, video-posts, 2D streaming, tube-video, and blog/RSS feed sources. Minimal by design: pure `fetch`, JSON, and hardened HTML parsing — nothing else.

These modules handle the hard parts for you:

- **manga** — reverse-engineered encrypted API (XOR + time-rotating keys), fully implemented
- **neko** — WordPress HTML parsing (lists, categories, genres, detail, players)
- **htv** — public JSON API + Next.js RSC payload parsing (genres, series, trending, most-viewed)
- **tube** — official video API + HTML parsing (categories, top-rated, most-viewed, mp4 sources)
- **feeds** — external blog/RSS aggregators (WordPress REST, Wix RSS, blog crawler)

Every function returns normalized, sanitized data — safe to render in your own UI.

---

## Features

- 🔌 **Zero dependencies** — pure Node.js `fetch`, runs on Node ≥ 18.17, Bun, Deno, and serverless runtimes
- 🧩 **Modular** — import one source or all of them; every source is self-contained
- 🔐 **Security built-in** — SSRF protection, URL scheme filtering (`javascript:`, `data:`, ...), HTML stripping
- ⏱️ **TTL caching** — in-memory cache with per-source TTLs; pluggable for Redis/DB backends
- 🛡️ **Hardened parsing** — regex/JSON-LD/RSC parsers that survive markup changes, dedupe, and discard ads/tracking
- 🌐 **Configurable** — base URLs, timeouts, user agents, and credentials via env vars or runtime config
- 📦 **Tree-shakeable ESM** — import only what you need

## Supported sources

| Codename | Type | Auth | Export path |
| --- | --- | --- | --- |
| manga | Manga / doujinshi / manhwa (encrypted SPA API) | app secret + salt | `kuroneko/doujindesu` |
| neko | Video posts (WordPress) | none | `kuroneko/nekopoi` |
| htv | 2D animation streaming | none | `kuroneko/hentaitv` |
| tube | Tube video API | none | `kuroneko/eporner` |
| feeds | Blog/RSS aggregators | none | `kuroneko/external` |

Actual base URLs live in `src/*.js` (as `DEFAULT_*` constants) and can be overridden via env vars — see `.env.example`.

---

## Requirements

- Node.js **≥ 18.17** (global `fetch` required) — or any runtime that provides `fetch`
- **manga source only**: valid `DOUJIN_APP_SECRET` and `DOUJIN_SALT` credentials

## Installation

```bash
npm install kuroneko
```

No build step, no transitive dependencies.

---

## Quick start

```js
import { scrapeHentaiList, scrapeHentaiDetail } from 'kuroneko';

// List latest videos
const { videos, hasNext, total } = await scrapeHentaiList({ page: 1 });
console.log(videos[0]); // { id, slug, title, displayTitle, thumb, embedUrl, views, ... }

// Full detail with player embed
const detail = await scrapeHentaiDetail(videos[0].slug);
console.log(detail.embedUrl); // player URL
```

Import one source only:

```js
import { scrapeMangaList } from 'kuroneko/doujindesu';
import { scrapeNekoDetail } from 'kuroneko/nekopoi';
import { scrapeEpornerList } from 'kuroneko/eporner';
```

---

## Configuration

### Credentials — where to get the secrets

**manga source — `DOUJIN_APP_SECRET` + `DOUJIN_SALT` (required)**

The manga API is a React SPA whose responses are encrypted. The app's JS bundle contains both values; the secret is also sent as a request header on every API call:

1. Open the site in Chrome/Firefox.
2. Press `F12` → **Network** tab → reload the page.
3. Click any request to `/api/*` (e.g. `/api/manga`).
4. Under **Request Headers** you'll find `X-App-Secret` (or `x-app-secret`) — that is `DOUJIN_APP_SECRET`.
5. For the salt: in the **Sources** tab, open the site's JS bundle and search for the string used to build the key (the module builds keys as `salt_bucket` per hour — see `src/doujindesu.js` for exactly what it derives). That value is `DOUJIN_SALT`.

> The site can rotate these — if requests start failing with `Failed to decrypt server response`, re-grab both values.

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DOUJIN_APP_SECRET` | — | manga API app secret (**required**) |
| `DOUJIN_SALT` | — | key-rotation salt (**required**) |
| `DOUJIN_BASE_URL` | (see `src/doujindesu.js`) | manga base URL |
| `DOUJIN_USER_AGENT` | Chrome UA | manga user agent |
| `DOUJIN_TIMEOUT_MS` | `30000` | manga request timeout |
| `NEKO_BASE_URL` | (see `src/nekopoi.js`) | neko base URL |
| `NEKO_TIMEOUT_MS` | `30000` | neko request timeout |
| `HENTAI_BASE_URL` | (see `src/hentaitv.js`) | htv base URL |
| `HENTAI_TIMEOUT_MS` | `30000` | htv request timeout |
| `EPORNER_BASE_URL` | (see `src/eporner.js`) | tube HTML base URL |
| `EPORNER_API_BASE` | (see `src/eporner.js`) | tube API base URL |
| `EPORNER_TIMEOUT_MS` | `30000` | tube request timeout |

Runtime equivalents: `configureDoujin()`, `configureNeko()`, `configureHentai()`, `configureEporner()` — each accepts the relevant subset (`baseUrl`, `userAgent`, `timeoutMs`, `cacheTtl`, plus `appSecret`/`salt` for the manga source).

---

## How the scraping works

### manga (`src/doujindesu.js`) — encrypted SPA API
The site is a React SPA: content is served through `/api/*` and responses are encrypted (`_enc_resp_`) with a chained-XOR cipher whose key rotates every hour. The module mimics the site's own bundle:
1. Sends `X-App-Secret` + `x-device-id` headers.
2. Receives `{"_enc_resp_": "<hex>"}`.
3. Tries the current hourly key bucket (±1 for clock drift), decrypts byte-by-byte (`ch = w ^ p ^ (d*13) ^ n`, `n` evolves per byte), then `decodeURIComponent` + `JSON.parse`.
4. Normalizes into cards/detail. **Note:** the API ignores `page` — the module translates it to `offset` so pagination actually works.

### neko (`src/nekopoi.js`) — WordPress HTML
Plain HTML fetching with a mobile UA:
- Lists parse two card formats (`nk-post-card` on home, `nk-search-item` on category pages), keeping only internal links.
- Detail extracts the `<title>`, `og:image` thumbnail, synopsis, and iframe players — **filtered against an allowlist of player hosts**; ad/tracking/embedding iframes are discarded.

### htv (`src/hentaitv.js`) — public JSON API + RSC payload
- Browse/search: `GET /api/browse?page=N` (public JSON, 28/page).
- Detail: the browse API can't reliably resolve slugs, so the module fetches the HTML detail page and parses the embedded **JSON-LD VideoObject** (embedUrl, genre, views, ISO-8601 duration) + genre chips; falls back to API search.
- Genre/series/trending pages are server-rendered — data lives in the **Next.js RSC payload** (`self.__next_f.push(...)`). The module joins the escaped chunks, strips global widget state (notifications/history — they leak into every page), and extracts balanced JSON objects.

### tube (`src/eporner.js`) — official JSON API + HTML
- List/search: public v2 API (`/api/v2/video/search/`), no key.
- Detail: `/api/v2/video/id?id=...` **requires a `Referer` header** (otherwise it returns `[]`). Direct mp4 `src[]` per quality is included; when the API omits it, the module scrapes `/dload/<id>/<quality>/` links from the video page (they 302 to a signed CDN supporting range requests).
- Categories/top-rated/most-viewed: parsed from HTML pages (`mb hdy` blocks); `rel="next"` in `<head>` signals pagination.

### feeds (`src/external.js`) — blog/RSS aggregators
- WordPress REST (`wp-json/wp/v2/posts?_embed` → featured media) for a games blog.
- Wix RSS (`blog-feed.xml`) parsed with regex + XML entity decoding.
- Blog crawler collecting post links and forum thread links from a set of known pages.

---

## API reference

### manga — `kuroneko/doujindesu`

| Function | Description |
| --- | --- |
| `scrapeMangaList({ page, query, type, genre, sort, limit })` | Paginated list with filters. `type`: `manga` \| `doujinshi` \| `manhwa`. `sort`: `latest_chapter` \| `views` \| `rating`. **Note:** the API ignores `page` — the module translates it to `offset` |
| `searchManga(query)` | Search by keyword |
| `scrapeGenres()` | All genres with counts, sorted DESC |
| `scrapeMangaDetail(slug)` | Full detail: cleaned synopsis, author/artist, genres, chapters, views |
| `scrapeChapterImages(id)` | Chapter image URLs + metadata |

### neko — `kuroneko/nekopoi`

| Function | Description |
| --- | --- |
| `scrapeNekoList(page)` | Latest posts `{ videos, hasNext }` |
| `scrapeNekoCategory(category, page)` | Posts by category |
| `scrapeNekoCategories()` | Category list |
| `scrapeNekoGenres()` | Genre list |
| `scrapeNekoGenre(slug, page)` | Posts by genre |
| `scrapeNekoDetail(slug)` | Detail: title, thumb, **sanitized player iframe URLs**, synopsis |
| `scrapeNekoRelated(slug, { limit })` | Recommendations (same-series first) |
| `scrapeNekoRandomSlug()` | Random post slug |

### htv — `kuroneko/hentaitv`

| Function | Description |
| --- | --- |
| `scrapeHentaiList({ page, query })` | Browse/search `{ videos, hasNext, total }` (28/page) |
| `scrapeHentaiDetail(slug)` | Detail via HTML + JSON-LD (embedUrl, tags, views, duration). Falls back to API search |
| `scrapeHentaiGenres()` | Genre list |
| `scrapeHentaiGenre(slug, page)` | Videos by genre (RSC payload) |
| `scrapeHentaiSeries()` | Series list |
| `scrapeHentaiSeriesDetail(slug)` | Episodes of a series |
| `scrapeHentaiTrending()` | Trending videos |
| `scrapeHentaiMostViewed()` | Most-viewed (aggregates 6 pages, sorts by views) |
| `scrapeHentaiRelated(slug, { limit })` | Recommendations (same series first) |
| `scrapeHentaiRandomSlug()` | Random slug (follows `/random` 307 redirect) |

### tube — `kuroneko/eporner`

| Function | Description |
| --- | --- |
| `scrapeEpornerList({ page, query, order })` | Browse/search (28/page). `order`: `top-rated` |
| `scrapeEpornerDetail(id)` | Detail: embedUrl, **direct mp4 `src[]` per quality**, description |
| `scrapeEpornerCategories()` | Category list |
| `scrapeEpornerCategory(slug, page)` | Videos by category |
| `scrapeEpornerListingPage(kind, page)` | `top-rated` or `most-viewed` listings |
| `scrapeEpornerRelated(id, { tags, title, limit })` | Recommendations (tag-based first) |
| `scrapeEpornerRandomId()` | Random video id |

### feeds — `kuroneko/external`

| Function | Description |
| --- | --- |
| `scrapeCollectionsof18(page, perPage)` | WordPress REST posts |
| `c18ToExternal(items)` | Normalize to `{ source, title, cover, url, meta }` |
| `scrapeDaports()` | Wix RSS feed items |
| `daportsToExternal(items)` | Normalize |
| `scrapeKoga3()` | Blog pages → posts + forum links |
| `kogaToExternal(items)` | Normalize |

---

## Caching

All scrapers share an in-memory TTL cache (`src/cache.js`):

- Lists and details: **10 min** TTL (manga: 1 h)
- Genres/series/categories: **1 h**
- Trending / most-viewed: **30 min – 1 h**
- Related recommendations: **2 min** (stays fresh, like YouTube)

```js
import { getCache, setCache, clearCache, cacheSize } from 'kuroneko';

clearCache();          // drop everything
cacheSize();           // number of entries
```

> **Multi-instance deployments**: the default cache is per-process. For serverless/edge deployments with many instances, override `getCache`/`setCache` with your own Redis/Upstash-backed store — the scrapers call these two functions exclusively.

## Security

All data returned by these scrapers passes through `src/security.js`:

- `safeHttpUrl()` — forces `http(s)://`, rejects `javascript:`, `data:`, `vbscript:`, relative paths
- `isSafeExternalUrl()` — SSRF protection: rejects localhost, private/loopback/link-local IPs, non-standard ports, and DNS-rebinding targets
- `stripHtml()` — removes tags/scripts/styles from external text
- neko players are allowlisted by hostname; ad/tracking iframes are dropped
- manga synopsis HTML is double-decoded and cleaned (the API double-encodes entities)

```js
import { safeHttpUrl, stripHtml, isSafeExternalUrl } from 'kuroneko';
```

## Error handling

All functions throw plain `Error`s with descriptive messages:

- `HTTP 404 for /api/manga/xxx` — upstream returned an error status
- `Video xxx not found` — no such item on the source
- `Failed to decrypt server response` — wrong/missing manga credentials
- Invalid input (bad slug/id/genre) throws `Error('Invalid ...')` immediately

Network timeouts abort after the configured `timeoutMs` (default 30 s) via `AbortSignal.timeout`.

## Examples

### Next.js App Router route handler

```js
// app/api/hentai/route.js
import { NextResponse } from 'next/server';
import { scrapeHentaiList } from 'kuroneko';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get('page')) || 1;
  try {
    const data = await scrapeHentaiList({ page });
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=600' },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
```

### Plain Node script

```js
import { scrapeEpornerListingPage, clearCache } from 'kuroneko';

const { videos } = await scrapeEpornerListingPage('most-viewed');
for (const v of videos.slice(0, 5)) console.log(v.views, v.title);
clearCache();
```

See `examples/basic.js` for a full walkthrough of all four sources.

## Testing

```bash
npm test          # offline suite — import + crypto (no network needed)
npm run test:live # live smoke against the sources (needs network; manga section needs credentials)
```

## Disclaimer

This library is for **educational and personal-use purposes only**. The scraped sources are third-party websites; this project is not affiliated with, endorsed by, or connected to any of them. You are responsible for:

- Complying with the terms of service of the sites you scrape
- Complying with the laws of your jurisdiction regarding adult content
- Respecting rate limits — the built-in caching already reduces request volume significantly

## License

[MIT](LICENSE) © Bagas
