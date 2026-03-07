/**
 * AgentFolio Cache Module
 * In-memory LRU cache with TTL — drop-in replacement for Redis later
 * 
 * Usage:
 *   const cache = require('./cache');
 *   cache.set('key', value, 60);  // 60s TTL
 *   cache.get('key');             // returns value or null
 *   cache.wrap('key', 60, () => expensiveFn());  // cache-aside pattern
 */

const logger = require('../logger');

class LRUCache {
  constructor({ maxSize = 1000, defaultTTL = 300, name = 'default' } = {}) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL; // seconds
    this.name = name;
    this.store = new Map(); // key -> { value, expiresAt }
    this.hits = 0;
    this.misses = 0;
    
    // Cleanup expired entries every 60s
    this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    // Move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key, value, ttlSeconds) {
    const ttl = (ttlSeconds || this.defaultTTL) * 1000;
    // Evict oldest if at capacity
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }

  /**
   * Cache-aside pattern: return cached or compute & cache
   */
  async wrap(key, ttlSeconds, fn) {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const value = await fn();
    if (value !== undefined && value !== null) {
      this.set(key, value, ttlSeconds);
    }
    return value;
  }

  /**
   * Synchronous version of wrap
   */
  wrapSync(key, ttlSeconds, fn) {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const value = fn();
    if (value !== undefined && value !== null) {
      this.set(key, value, ttlSeconds);
    }
    return value;
  }

  del(key) {
    return this.store.delete(key);
  }

  /**
   * Invalidate all keys matching a prefix
   */
  invalidate(prefix) {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  clear() {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      name: this.name,
      size: this.store.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : 'N/A'
    };
  }

  _cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug(`Cache[${this.name}]: cleaned ${cleaned} expired entries`);
    }
  }

  destroy() {
    clearInterval(this._cleanupInterval);
    this.store.clear();
  }
}

// Named cache instances
const caches = {
  profiles: new LRUCache({ maxSize: 500, defaultTTL: 120, name: 'profiles' }),
  search: new LRUCache({ maxSize: 200, defaultTTL: 60, name: 'search' }),
  leaderboard: new LRUCache({ maxSize: 50, defaultTTL: 300, name: 'leaderboard' }),
  api: new LRUCache({ maxSize: 300, defaultTTL: 180, name: 'api' }),
};

// Convenience: default cache
const defaultCache = new LRUCache({ maxSize: 1000, defaultTTL: 300, name: 'default' });

module.exports = {
  LRUCache,
  caches,
  // Default cache methods
  get: (key) => defaultCache.get(key),
  set: (key, value, ttl) => defaultCache.set(key, value, ttl),
  del: (key) => defaultCache.del(key),
  wrap: (key, ttl, fn) => defaultCache.wrap(key, ttl, fn),
  wrapSync: (key, ttl, fn) => defaultCache.wrapSync(key, ttl, fn),
  invalidate: (prefix) => defaultCache.invalidate(prefix),
  clear: () => { Object.values(caches).forEach(c => c.clear()); defaultCache.clear(); },
  stats: () => ({
    default: defaultCache.stats(),
    ...Object.fromEntries(Object.entries(caches).map(([k, v]) => [k, v.stats()]))
  }),
};
