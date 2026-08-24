// In-memory TTL cache shared across all scrapers.
// Simple Map-based implementation — no external dependencies.
// Suitable for single-process runtimes (Node server, serverless functions,
// workers). For multi-instance deployments, wrap the cache functions with
// your own Redis/DB-backed store (see README).

const cache = new Map();

/**
 * Get a cached value. Returns null when missing or expired.
 * @param {string} key
 * @returns {*} value or null
 */
export function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Store a value with a TTL.
 * @param {string} key
 * @param {*} value
 * @param {number} ttlSeconds - seconds until expiry (default 1 hour)
 */
export function setCache(key, value, ttlSeconds = 3600) {
  cache.set(key, {
    value,
    expiry: Date.now() + ttlSeconds * 1000,
  });
}

/** Remove every cached entry. */
export function clearCache() {
  cache.clear();
}

/** Number of entries currently held. Useful for debugging/monitoring. */
export function cacheSize() {
  return cache.size;
}
