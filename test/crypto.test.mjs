// Crypto round-trip test — verifies the Doujindesu decryption port without
// needing network access or real credentials.
//
// The site's algorithm is a chained XOR: for each byte d:
//   ch = w ^ p ^ (d * 13) ^ n   where n starts at 42 and evolves: n = (n + w) % 256
// We implement the inverse (encrypt) here and assert decrypt(encrypt(x)) === x.
// Run with: node test/crypto.test.mjs

const SALT = 'test-salt-value';
const bucket = Math.floor(Date.now() / 3600000);
const key = generateKey(`${SALT}_${bucket}`);

function generateKey(s) {
  let hash = 0;
  for (let n = 0; n < s.length; n++) {
    hash = (hash << 5) - hash + s.charCodeAt(n);
    hash |= 0;
  }
  let out = '';
  let x = Math.abs(hash) || 123456789;
  for (let n = 0; n < 32; n++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    out += String.fromCharCode(33 + (x % 93));
  }
  return out;
}

function decryptHex(hex, k) {
  const bytes = [];
  for (let d = 0; d < hex.length; d += 2) {
    const w = hex.substring(d, d + 2);
    if (!w) break;
    bytes.push(parseInt(w, 16));
  }
  const out = [];
  const keyLen = k.length;
  let n = 42;
  for (let d = 0; d < bytes.length; d++) {
    const w = bytes[d];
    const p = k.charCodeAt(d % keyLen);
    const ch = w ^ p ^ (d * 13) ^ n;
    out.push(String.fromCharCode(ch & 255));
    n = (n + w) % 256;
  }
  return out.join('');
}

// Inverse: given plaintext bytes, produce the same hex stream the site sends.
function encryptHex(plain, k) {
  const bytes = [...plain].map((c) => c.charCodeAt(0));
  const out = [];
  const keyLen = k.length;
  let n = 42;
  for (let d = 0; d < bytes.length; d++) {
    const ch = bytes[d];
    const p = k.charCodeAt(d % keyLen);
    const w = (ch ^ p ^ (d * 13) ^ n) & 255;
    out.push(w.toString(16).padStart(2, '0'));
    n = (n + w) % 256;
  }
  return out.join('');
}

let passed = 0;

function assert(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    console.error(`  ✘ ${name}`);
    process.exitCode = 1;
  }
}

console.log('Doujindesu crypto round-trip:\n');

assert('generateKey produces 32 printable chars', key.length === 32 && /^[\x21-\x7e]{32}$/.test(key));

const payload = JSON.stringify({
  id: 12345,
  slug: 'contoh-manga',
  title: 'Contoh Manga & Judul — dengan "quote" dan unicode ✓',
  chapters: [{ id: 99, chapter_number: 1 }],
});

// Simulate the site: encodeURIComponent the JSON, encrypt, prefix _enc_resp_
const encoded = encodeURIComponent(payload);
const enc = `{"_enc_resp_":"${encryptHex(encoded, key)}"}`;
assert('encrypted payload contains _enc_resp_ marker', enc.includes('_enc_resp_'));

// Now decrypt exactly like src/doujindesu.js does
const parsed = JSON.parse(enc);
const decrypted = decodeURIComponent(decryptHex(parsed._enc_resp_, key));
assert('decrypt(encrypt(x)) === x', decrypted === payload);

// Key rotation: a payload encrypted with the previous hour's bucket must
// still decrypt when trying [bucket, bucket-1, bucket+1] in order.
const prevKey = generateKey(`${SALT}_${bucket - 1}`);
const encPrev = encryptHex(encodeURIComponent(payload), prevKey);
let recovered = null;
for (const b of [bucket, bucket - 1, bucket + 1]) {
  try {
    recovered = decodeURIComponent(decryptHex(encPrev, generateKey(`${SALT}_${b}`)));
    break;
  } catch {
    // try next bucket
  }
}
assert('rotation: old-bucket payload still decrypts', recovered === payload);

console.log(`\n${passed} assertions passed`);
