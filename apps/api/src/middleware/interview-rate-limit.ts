type Bucket = { count: number; expiresAt: number };

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Initial single-process protection, not a distributed or persistent limiter. */
export function createInterviewRateLimiter(options: {
  windowMs?: number;
  perAddress?: number;
  global?: number;
  maxAddresses?: number;
  now?: () => number;
} = {}) {
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const perAddress = options.perAddress ?? 5;
  const globalLimit = options.global ?? 100;
  const maxAddresses = options.maxAddresses ?? 10_000;
  const now = options.now ?? Date.now;
  for (const count of [windowMs, perAddress, globalLimit, maxAddresses]) {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("Rate-limit settings must be positive integers.");
  }
  const addresses = new Map<string, Bucket>();
  let globalBucket: Bucket = { count: 0, expiresAt: 0 };

  return (address: string): RateLimitResult => {
    const time = now();
    if (globalBucket.expiresAt <= time) {
      globalBucket = { count: 0, expiresAt: time + windowMs };
      for (const [key, bucket] of addresses) if (bucket.expiresAt <= time) addresses.delete(key);
    }
    let bucket = addresses.get(address);
    if (bucket && bucket.expiresAt <= time) {
      addresses.delete(address);
      bucket = undefined;
    }
    const denied = (expiresAt: number): RateLimitResult => ({
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - time) / 1000)),
    });
    if (globalBucket.count >= globalLimit) return denied(globalBucket.expiresAt);
    if (bucket && bucket.count >= perAddress) return denied(bucket.expiresAt);
    if (!bucket) {
      if (addresses.size >= maxAddresses) return denied(globalBucket.expiresAt);
      bucket = { count: 0, expiresAt: time + windowMs };
      addresses.set(address, bucket);
    }
    // Count malformed, honeypot and failed attempts too. Repeated invalid payloads
    // must not provide an unmetered path to parsers or database connections.
    bucket.count += 1;
    globalBucket.count += 1;
    return { allowed: true };
  };
}
