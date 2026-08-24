// kuroneko — zero-dependency scraping modules for media cataloging.
// Framework-agnostic, works in Node.js >= 18.17, Bun, serverless functions,
// or any JS runtime with global fetch.
//
// Usage:
//   import { scrapeMangaList, scrapeHentaiList } from 'kuroneko';
//
// Each source can be imported standalone:
//   import { scrapeNekoList } from 'kuroneko/nekopoi';

export {
  scrapeMangaList,
  scrapeGenres,
  scrapeMangaDetail,
  scrapeChapterImages,
  searchManga,
  configureDoujin,
} from './doujindesu.js';

export {
  scrapeNekoList,
  scrapeNekoCategory,
  scrapeNekoCategories,
  scrapeNekoDetail,
  scrapeNekoGenres,
  scrapeNekoGenre,
  scrapeNekoRelated,
  scrapeNekoRandomSlug,
  configureNeko,
} from './nekopoi.js';

export {
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
  configureHentai,
} from './hentaitv.js';

export {
  scrapeEpornerList,
  scrapeEpornerDetail,
  scrapeEpornerCategories,
  scrapeEpornerCategory,
  scrapeEpornerListingPage,
  scrapeEpornerRelated,
  scrapeEpornerRandomId,
  configureEporner,
} from './eporner.js';

export {
  decodeXml,
  scrapeCollectionsof18,
  c18ToExternal,
  scrapeDaports,
  daportsToExternal,
  scrapeKoga3,
  kogaToExternal,
} from './external.js';

export { getCache, setCache, clearCache, cacheSize } from './cache.js';
export { safeHttpUrl, stripHtml, sanitizeUrl, isSafeExternalUrl } from './security.js';
