import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL!, {
  tls: {
    rejectUnauthorized: false,
  },
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

export default redis;