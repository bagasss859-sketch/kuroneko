// kuroneko — basic usage example.
// Run with: npm run example  (or: node examples/basic.js)
//
// The manga source requires credentials. Copy .env.example to .env and fill
// in DOUJIN_APP_SECRET + DOUJIN_SALT, then run with:
//   node --env-file=.env examples/basic.js

import {
  scrapeMangaList,
  scrapeMangaDetail,
  scrapeNekoList,
  scrapeNekoDetail,
  scrapeHentaiList,
  scrapeHentaiDetail,
  scrapeEpornerList,
  scrapeEpornerDetail,
} from '../src/index.js';

async function main() {
  // ── 1. Doujindesu (manga/doujinshi) ─────────────────────────────────
  try {
    const list = await scrapeMangaList({ page: 1, limit: 5 });
    console.log('Doujindesu list:', list.length, 'items');
    if (list[0]) console.log('  first:', list[0].title, '→', list[0].slug);

    const detail = await scrapeMangaDetail(list[0].slug);
    console.log('  detail:', detail.title, '| chapters:', detail.chapters.length);
  } catch (err) {
    console.log('Doujindesu skipped:', err.message);
  }

  // ── 2. NekoPoi (video posts) ────────────────────────────────────────
  try {
    const { videos, hasNext } = await scrapeNekoList(1);
    console.log('NekoPoi list:', videos.length, 'items, hasNext:', hasNext);
    if (videos[0]) {
      console.log('  first:', videos[0].title, '→', videos[0].slug);
      const detail = await scrapeNekoDetail(videos[0].slug);
      console.log('  detail players:', detail.players.length);
    }
  } catch (err) {
    console.log('NekoPoi skipped:', err.message);
  }

  // ── 3. Hentai.tv (streaming hentai) ─────────────────────────────────
  try {
    const { videos, total } = await scrapeHentaiList({ page: 1 });
    console.log('Hentai.tv list:', videos.length, 'items, total:', total);
    if (videos[0]) {
      console.log('  first:', videos[0].displayTitle, '→', videos[0].slug);
      const detail = await scrapeHentaiDetail(videos[0].slug);
      console.log('  detail embed:', detail.embedUrl);
    }
  } catch (err) {
    console.log('Hentai.tv skipped:', err.message);
  }

  // ── 4. Eporner (tube videos) ────────────────────────────────────────
  try {
    const { videos, total } = await scrapeEpornerList({ page: 1 });
    console.log('Eporner list:', videos.length, 'items, total:', total);
    if (videos[0]) {
      console.log('  first:', videos[0].title, '→', videos[0].id);
      const detail = await scrapeEpornerDetail(videos[0].id);
      console.log('  detail sources:', detail.src.length, '| embed:', detail.embedUrl);
    }
  } catch (err) {
    console.log('Eporner skipped:', err.message);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
