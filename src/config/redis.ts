import Redis from 'ioredis';

   const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
     maxRetriesPerRequest: 3,
     retryStrategy(times) {
       const delay = Math.min(times * 50, 2000);
       return delay;
     },
   });

   redis.on('connect', () => {
     // Redis connected
   });

   redis.on('error', (err) => {
     console.error('❌ Redis error:', err);
   });

   export default redis;