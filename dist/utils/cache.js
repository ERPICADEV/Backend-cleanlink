"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCached = getCached;
exports.invalidatePattern = invalidatePattern;
const redis_1 = require("../config/redis");
// ==========================================
// Redis response caching (easy to remove)
// - Fail-open if Redis is unavailable
// - Short TTLs only (seconds)
// ==========================================
async function getCached(key, fetcher, ttlSeconds) {
    try {
        const cached = await redis_1.redis.get(key);
        if (cached)
            return JSON.parse(cached);
    }
    catch {
        // Fail-open: ignore Redis read errors
    }
    const data = await fetcher();
    try {
        await redis_1.redis.setex(key, ttlSeconds, JSON.stringify(data));
    }
    catch {
        // Fail-open: ignore Redis write errors
    }
    return data;
}
/**
 * Invalidate keys by pattern using SCAN (safe-ish; avoids KEYS).
 * Uses UNLINK when available (non-blocking), falls back to DEL.
 */
async function invalidatePattern(pattern) {
    try {
        // ioredis supports scanStream
        const stream = redis_1.redis.scanStream({ match: pattern, count: 200 });
        const pipeline = redis_1.redis.pipeline();
        let pending = 0;
        await new Promise((resolve) => {
            stream.on('data', (keys) => {
                if (!keys || keys.length === 0)
                    return;
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
    }
    catch {
        // Fail-open
    }
}
