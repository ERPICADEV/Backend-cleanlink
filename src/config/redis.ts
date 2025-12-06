import Redis from "ioredis";

// Clean and parse REDIS_URL
let redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Decode URL-encoded characters
try {
  redisUrl = decodeURIComponent(redisUrl);
} catch (e) {
  // If decoding fails, use as-is
}

// Remove any command-line flags or extra parameters
// Extract just the redis:// or rediss:// URL
const urlMatch = redisUrl.match(/(rediss?:\/\/[^\s]+)/i);
if (urlMatch) {
  redisUrl = urlMatch[1];
} else {
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

export const redis = new Redis(redisUrl, {
  ...(needsTLS && {
    tls: {
      rejectUnauthorized: false,
    },
  }),
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  enableOfflineQueue: true,
});

redis.on("connect", () => {
  console.log("🔗 Redis connected successfully");
});

redis.on("error", (err) => {
  console.error("⚠️ Redis error:", err.message);
});

redis.on("ready", () => {
  console.log("✅ Redis ready");
});

export default redis;