// Counts failed attempts per key inside a fixed window. In-memory, so it
// resets on restart and is per-process (documented in the README).
export function createLimiter({ max, windowMs }) {
  const entries = new Map();

  const current = (key, now) => {
    const entry = entries.get(key);
    if (entry && now - entry.first > windowMs) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    retryAfterSeconds(key, now = Date.now()) {
      const entry = current(key, now);
      if (!entry || entry.count < max) return 0;
      return Math.ceil((entry.first + windowMs - now) / 1000);
    },
    recordFailure(key, now = Date.now()) {
      const entry = current(key, now);
      if (entry) {
        entry.count += 1;
        return;
      }
      if (entries.size > 5000) {
        for (const k of entries.keys()) current(k, now);
      }
      entries.set(key, { count: 1, first: now });
    },
    clear(key) {
      entries.delete(key);
    },
  };
}
