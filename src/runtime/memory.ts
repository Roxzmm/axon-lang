// ============================================================
// Axon Language — Memory Optimization
// ============================================================
// Implements object pooling and string interning to reduce
// memory allocations and GC pressure.

// ─── String Interning ────────────────────────────────────────
// Cache frequently used strings to reduce memory usage

const STRING_INTERN_CACHE = new Map<string, string>();
const MAX_INTERN_LENGTH = 256; // Only intern strings up to 256 chars
const MAX_CACHE_SIZE = 10000;  // Limit cache size

export function internString(s: string): string {
  // Don't intern very long strings
  if (s.length > MAX_INTERN_LENGTH) {
    return s;
  }

  const cached = STRING_INTERN_CACHE.get(s);
  if (cached !== undefined) {
    return cached;
  }

  // Limit cache size to prevent unbounded growth
  if (STRING_INTERN_CACHE.size >= MAX_CACHE_SIZE) {
    // Clear oldest entries (simple strategy: clear half the cache)
    const entries = Array.from(STRING_INTERN_CACHE.entries());
    STRING_INTERN_CACHE.clear();
    // Keep the second half (more recently added)
    for (let i = Math.floor(entries.length / 2); i < entries.length; i++) {
      STRING_INTERN_CACHE.set(entries[i][0], entries[i][1]);
    }
  }

  STRING_INTERN_CACHE.set(s, s);
  return s;
}

// ─── Small Integer Caching ───────────────────────────────────
// Cache small integers to avoid repeated BigInt allocations

const INT_CACHE_MIN = -128;
const INT_CACHE_MAX = 1024;
const INT_CACHE = new Map<number, bigint>();

// Pre-populate cache
for (let i = INT_CACHE_MIN; i <= INT_CACHE_MAX; i++) {
  INT_CACHE.set(i, BigInt(i));
}

export function getCachedInt(n: number): bigint | null {
  if (n >= INT_CACHE_MIN && n <= INT_CACHE_MAX && Number.isInteger(n)) {
    return INT_CACHE.get(n) ?? null;
  }
  return null;
}

// ─── Map Pool ────────────────────────────────────────────────
// Pool of Map objects for Records and Enums to reduce allocations

const MAP_POOL: Map<string, any>[] = [];
const MAX_POOL_SIZE = 1000;

export function getPooledMap<K, V>(): Map<K, V> {
  const map = MAP_POOL.pop();
  if (map) {
    map.clear();
    return map as Map<K, V>;
  }
  return new Map<K, V>();
}

export function releaseMap(map: Map<any, any>): void {
  if (MAP_POOL.length < MAX_POOL_SIZE) {
    map.clear();
    MAP_POOL.push(map);
  }
}

// ─── Memory Statistics ───────────────────────────────────────

export interface MemoryStats {
  stringCacheSize: number;
  stringCacheHits: number;
  stringCacheMisses: number;
  intCacheHits: number;
  intCacheMisses: number;
  mapPoolSize: number;
  mapPoolHits: number;
  mapPoolMisses: number;
}

let stringCacheHits = 0;
let stringCacheMisses = 0;
let intCacheHits = 0;
let intCacheMisses = 0;
let mapPoolHits = 0;
let mapPoolMisses = 0;

export function getMemoryStats(): MemoryStats {
  return {
    stringCacheSize: STRING_INTERN_CACHE.size,
    stringCacheHits,
    stringCacheMisses,
    intCacheHits,
    intCacheMisses,
    mapPoolSize: MAP_POOL.length,
    mapPoolHits,
    mapPoolMisses,
  };
}

export function resetMemoryStats(): void {
  stringCacheHits = 0;
  stringCacheMisses = 0;
  intCacheHits = 0;
  intCacheMisses = 0;
  mapPoolHits = 0;
  mapPoolMisses = 0;
}

// Update tracking functions
export function trackStringCacheHit(): void {
  stringCacheHits++;
}

export function trackStringCacheMiss(): void {
  stringCacheMisses++;
}

export function trackIntCacheHit(): void {
  intCacheHits++;
}

export function trackIntCacheMiss(): void {
  intCacheMisses++;
}

export function trackMapPoolHit(): void {
  mapPoolHits++;
}

export function trackMapPoolMiss(): void {
  mapPoolMisses++;
}
