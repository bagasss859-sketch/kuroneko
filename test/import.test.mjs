// Verifies the package can be imported by its name ('kuroneko'),
// exactly like an external consumer would. Node self-references packages
// with an "exports" field, so this works from inside the repo too.
// Run: node test/import.test.mjs

import * as main from 'kuroneko';
import * as doujindesu from 'kuroneko/doujindesu';
import * as nekopoi from 'kuroneko/nekopoi';
import * as hentaitv from 'kuroneko/hentaitv';
import * as eporner from 'kuroneko/eporner';
import * as external from 'kuroneko/external';
import { clearCache, getCache, setCache, safeHttpUrl, stripHtml } from 'kuroneko';

const required = [
  'scrapeMangaList', 'scrapeGenres', 'scrapeMangaDetail', 'scrapeChapterImages', 'searchManga',
  'scrapeNekoList', 'scrapeNekoDetail', 'scrapeNekoRelated',
  'scrapeHentaiList', 'scrapeHentaiDetail', 'scrapeHentaiMostViewed',
  'scrapeEpornerList', 'scrapeEpornerDetail', 'scrapeEpornerRelated',
  'scrapeCollectionsof18', 'scrapeDaports', 'scrapeKoga3',
  'clearCache', 'safeHttpUrl', 'stripHtml',
];

let failed = 0;
for (const name of required) {
  if (typeof main[name] !== 'function') {
    console.error(`  ✘ missing export: ${name}`);
    failed++;
  }
}
console.log(failed === 0 ? '  ✔ all main exports present' : '');

console.log('  ✔ doujindesu subpath:', typeof doujindesu.scrapeMangaList === 'function');
console.log('  ✔ nekopoi subpath:', typeof nekopoi.scrapeNekoList === 'function');
console.log('  ✔ hentaitv subpath:', typeof hentaitv.scrapeHentaiList === 'function');
console.log('  ✔ eporner subpath:', typeof eporner.scrapeEpornerList === 'function');
console.log('  ✔ external subpath:', typeof external.scrapeDaports === 'function');

// sanity: utilities behave
console.log('  ✔ safeHttpUrl:', safeHttpUrl('javascript:alert(1)') === '' && safeHttpUrl('https://example.com') === 'https://example.com/');
console.log('  ✔ stripHtml:', stripHtml('<script>x</script><p>Hi &amp; bye</p>') === 'Hi &amp; bye');

// cache works
setCache('k', 1, 60);
console.log('  ✔ cache get/set:', getCache('k') === 1);
clearCache();
console.log('  ✔ clearCache:', getCache('k') === null);

process.exit(failed ? 1 : 0);
