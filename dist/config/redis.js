"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
// Clean and parse REDIS_URL
let redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
// Decode URL-encoded characters
try {
    redisUrl = decodeURIComponent(redisUrl);
}
catch (e) {
    // If decoding fails, use as-is
}
// Remove any command-line flags or extra parameters
// Extract just the redis:// or rediss:// URL
const urlMatch = redisUrl.match(/(rediss?:\/\/[^\s]+)/i);
if (urlMatch) {
    redisUrl = urlMatch[1];
}
else {
    // Fallback: take everything before first space or newline
    redisUrl = redisUrl.trim().split(/\s+/)[0];
}
// For Upstash, convert redis:// to rediss:// if needed, or detect TLS requirement
const isUpstash = redisUrl.includes('upstash.io');
const needsTLS = redisUrl.startsWith('rediss://') || isUpstash;
// Convert redis:// to rediss:// for Upstash if not already
if (isUpstash && redisUrl.startsWith('redis://')) {
    redisUrl = redisUrl.replace('redis://', 'rediss://');
}
exports.redis = new ioredis_1.default(redisUrl, {
    ...(needsTLS && {
        tls: {
            rejectUnauthorized: false,
        },
    }),
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    enableOfflineQueue: true,
});
exports.redis.on("connect", () => {
    console.log("🔗 Redis connected successfully");
});
exports.redis.on("error", (err) => {
    console.error("⚠️ Redis error:", err.message);
});
exports.redis.on("ready", () => {
    console.log("✅ Redis ready");
});
exports.default = exports.redis;
