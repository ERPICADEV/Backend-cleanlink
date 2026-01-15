"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.strictLimiter = exports.authenticatedLimiter = exports.unauthenticatedLimiter = exports.rateLimiter = void 0;
const redis_1 = require("../config/redis");
const rateLimiter = (config) => {
    return async (req, res, next) => {
        try {
            // Use user ID if authenticated, otherwise IP address
            const identifier = req.userId || req.ip || 'unknown';
            const key = `ratelimit:${identifier}:${req.path}`;
            const current = await redis_1.redis.incr(key);
            if (current === 1) {
                // First request, set expiry
                await redis_1.redis.pexpire(key, config.windowMs);
            }
            if (current > config.maxRequests) {
                return res.status(429).json({
                    error: {
                        code: 'RATE_LIMIT',
                        message: `Too many requests. Retry after ${Math.ceil(config.windowMs / 1000)}s`,
                    },
                });
            }
            // Add rate limit headers
            res.setHeader('X-RateLimit-Limit', config.maxRequests);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - current));
            next();
        }
        catch (error) {
            console.error('Rate limiter error:', error);
            // Fail open - allow request if Redis is down
            next();
        }
    };
};
exports.rateLimiter = rateLimiter;
// Preset rate limiters per <Resources.pdf> specs
exports.unauthenticatedLimiter = (0, exports.rateLimiter)({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30,
});
exports.authenticatedLimiter = (0, exports.rateLimiter)({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 120,
});
exports.strictLimiter = (0, exports.rateLimiter)({
    windowMs: 24 * 60 * 60 * 1000, // 1 day
    maxRequests: 10, // For creating reports
});
