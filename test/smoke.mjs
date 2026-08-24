// Smoke test — verifies every exported function is callable and returns the
// expected shape. Requires network access to the source sites.
// Run with: npm test   (or: node test/smoke.mjs)
//
// NOTE: Doujindesu tests are skipped when DOUJIN_APP_SECRET / DOUJIN_SALT
// are not present. Copy .env.example → .env, fill the secrets, then run:
//   node --env-file=.env test/smoke.mjs

import {
  scrapeMangaList,
  scrapeGenres,
  scrapeMangaDetail,
  scrapeChapterImages,
  searchManga,
  scrapeNekoList,
  scrapeNekoCategory,
  scrapeNekoCategories,
  scrapeNekoDetail,
  scrapeNekoGenres,
  scrapeNekoGenre,
  scrapeNekoRelated,
  scrapeNekoRandomSlug,
  scrapeHentaiList,
  scrapeHentaiDetail,
  scrapeHentaiGenre,
  scrapeHentaiGenres,
  scrapeHentaiSeries,
  scrapeHentaiSeriesDetail,
  scrapeHentaiRandomSlug,
  scrapeHentaiTrending,
  scrapeHentaiMostViewed,
  scrapeHentaiRelated,
  scrapeEpornerList,
  scrapeEpornerDetail,
  scrapeEpornerCategories,
  scrapeEpornerCategory,
  scrapeEpornerListingPage,
  scrapeEpornerRelated,
  scrapeEpornerRandomId,
  clearCache,
} from '../src/index.js';

let passed = 0;
let failed = 0;

function check(name, fn) {
  return fn()
    .then((ok) => {
      if (ok) {
        passed++;
        console.log(`  ✔ ${name}`);
      } else {
        failed++;
        console.log(`  ✘ ${name} (bad shape)`);
      }
    })
    .catch((err) => {
      failed++;
      console.log(`  ✘ ${name} (${err.message})`);
    });
}

const isArr = Array.isArray;

async function main() {
  console.log('kuroneko smoke test\n');

  // ── Doujindesu ──────────────────────────────────────────────────────
  console.log('Doujindesu (requires credentials):');
  const hasDoujin = !!(process.env.DOUJIN_APP_SECRET && process.env.DOUJIN_SALT);
  if (hasDoujin) {
    let slug = '';
    await check('scrapeMangaList', async () => {
      const list = await scrapeMangaList({ page: 1, limit: 5 });
      slug = list[0]?.slug || '';
      return isArr(list) && list.length > 0 && list[0].title;
    });
    await check('searchManga', async () => {
      const list = await searchManga('love');
      return isArr(list);
    });
    await check('scrapeGenres', async () => {
      const g = await scrapeGenres();
      return isArr(g) && g.length > 0 && g[0].slug;
    });
    await check('scrapeMangaDetail', async () => {
      if (!slug) throw new Error('no slug from list');
      const d = await scrapeMangaDetail(slug);
      return d && d.title;
    });
    await check('scrapeChapterImages', async () => {
      const d = await scrapeMangaDetail(slug);
      const ch = d.chapters[0];
      if (!ch) throw new Error('no chapter');
      const imgs = await scrapeChapterImages(ch.id);
      return imgs.images.length > 0;
    });
  } else {
    console.log('  (skipped — set DOUJIN_APP_SECRET + DOUJIN_SALT)');
  }

  // ── NekoPoi ─────────────────────────────────────────────────────────
  console.log('\nNekoPoi:');
  await check('scrapeNekoList', async () => {
    const { videos, hasNext } = await scrapeNekoList(1);
    return isArr(videos) && typeof hasNext === 'boolean';
  });
  await check('scrapeNekoCategories', async () => {
    const c = await scrapeNekoCategories();
    return isArr(c);
  });
  await check('scrapeNekoGenres', async () => {
    const g = await scrapeNekoGenres();
    return isArr(g);
  });
  await check('scrapeNekoDetail + Related + Random', async () => {
    const { videos } = await scrapeNekoList(1);
    const slug = videos[0]?.slug;
    if (!slug) throw new Error('empty list');
    const d = await scrapeNekoDetail(slug);
    const rel = await scrapeNekoRelated(slug, { limit: 3 });
    const rnd = await scrapeNekoRandomSlug();
    return d.title && isArr(d.players) && isArr(rel) && typeof rnd === 'string';
  });
  await check('scrapeNekoCategory', async () => {
    const { videos, hasNext } = await scrapeNekoCategory('hentai');
    return isArr(videos) && typeof hasNext === 'boolean';
  });

  // ── Hentai.tv ───────────────────────────────────────────────────────
  console.log('\nHentai.tv:');
  await check('scrapeHentaiList', async () => {
    const { videos, total } = await scrapeHentaiList({ page: 1 });
    return isArr(videos) && videos.length > 0 && typeof total === 'number';
  });
  await check('scrapeHentaiGenres/Series', async () => {
    const [g, s] = await Promise.all([scrapeHentaiGenres(), scrapeHentaiSeries()]);
    return isArr(g) && isArr(s);
  });
  await check('scrapeHentaiDetail + Related', async () => {
    const { videos } = await scrapeHentaiList({ page: 1 });
    const slug = videos[0]?.slug;
    if (!slug) throw new Error('empty list');
    const d = await scrapeHentaiDetail(slug);
    const rel = await scrapeHentaiRelated(slug, { limit: 3 });
    return d.embedUrl && isArr(rel);
  });
  await check('scrapeHentaiGenre/Trending/MostViewed', async () => {
    const genres = await scrapeHentaiGenres();
    const gslug = genres[0]?.slug;
    if (!gslug) throw new Error('no genre');
    const [g, t, m, rnd] = await Promise.all([
      scrapeHentaiGenre(gslug, 1),
      scrapeHentaiTrending(),
      scrapeHentaiMostViewed(),
      scrapeHentaiRandomSlug(),
    ]);
    return isArr(g.videos) && isArr(t.videos) && isArr(m.videos) && typeof rnd === 'string';
  });

  // ── Eporner ─────────────────────────────────────────────────────────
  console.log('\nEporner:');
  await check('scrapeEpornerList', async () => {
    const { videos, total } = await scrapeEpornerList({ page: 1 });
    return isArr(videos) && videos.length > 0 && typeof total === 'number';
  });
  await check('scrapeEpornerCategories/Listing', async () => {
    const cats = await scrapeEpornerCategories();
    const listing = await scrapeEpornerListingPage('top-rated');
    return isArr(cats) && isArr(listing.videos);
  });
  await check('scrapeEpornerDetail + Related', async () => {
    const { videos } = await scrapeEpornerList({ page: 1 });
    const id = videos[0]?.id;
    if (!id) throw new Error('empty list');
    const d = await scrapeEpornerDetail(id);
    const rel = await scrapeEpornerRelated(id, { tags: d.tags, title: d.title, limit: 3 });
    const rnd = await scrapeEpornerRandomId();
    return d.embedUrl && isArr(rel) && typeof rnd === 'string';
  });
  await check('scrapeEpornerCategory', async () => {
    const cats = await scrapeEpornerCategories();
    const slug = cats.find((c) => c.slug !== 'all')?.slug;
    if (!slug) throw new Error('no category');
    const { videos } = await scrapeEpornerCategory(slug);
    return isArr(videos);
  });

  clearCache();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
