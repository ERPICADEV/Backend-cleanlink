import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  // Add connection timeout
  connectTimeout: 5000,
  enableOfflineQueue: false, // Don't queue commands if disconnected
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.warn('⚠️  Redis error (non-blocking):', err.message);
});

redis.on('ready', () => {
  console.log('✅ Redis ready');
});

export default redis;