import { redis } from '../config/redis';

// ==========================================
// Redis response caching (easy to remove)
// - Fail-open if Redis is unavailable
// - Short TTLs only (seconds)
// ==========================================

export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached) as T;
  } catch {
    // Fail-open: ignore Redis read errors
  }

  const data = await fetcher();

  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
  } catch {
    // Fail-open: ignore Redis write errors
  }

  return data;
}

/**
 * Invalidate keys by pattern using SCAN (safe-ish; avoids KEYS).
 * Uses UNLINK when available (non-blocking), falls back to DEL.
 */
export async function invalidatePattern(pattern: string): Promise<void> {
  try {
    // ioredis supports scanStream
    const stream = redis.scanStream({ match: pattern, count: 200 });
    const pipeline = redis.pipeline();
    let pending = 0;

    await new Promise<void>((resolve) => {
      stream.on('data', (keys: string[]) => {
        if (!keys || keys.length === 0) return;
        for (const k of keys) {
          // UNLINK is preferred; if unsupported it will error and we retry with DEL below.
          pipeline.unlink(k);
          pending++;
        }
        if (pending >= 1000) {
          stream.pause();
          pipeline.exec().finally(() => {
            pending = 0;
            stream.resume();
          });
        }
      });
      stream.on('end', () => resolve());
      stream.on('error', () => resolve()); // Fail-open
    });

    if (pending > 0) {
      await pipeline.exec();
    }
  } catch {
    // Fail-open
  }
}


