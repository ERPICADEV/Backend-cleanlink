import { Request, Response, NextFunction } from 'express';
   import redis from '../config/redis';

   interface RateLimitConfig {
     windowMs: number;
     maxRequests: number;
   }

   export const rateLimiter = (config: RateLimitConfig) => {
     return async (req: Request, res: Response, next: NextFunction) => {
       try {
         // Use user ID if authenticated, otherwise IP address
         const identifier = (req as any).userId || req.ip || 'unknown';
         const key = `ratelimit:${identifier}:${req.path}`;
         
         const current = await redis.incr(key);
         
         if (current === 1) {
           // First request, set expiry
           await redis.pexpire(key, config.windowMs);
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
       } catch (error) {
         console.error('Rate limiter error:', error);
         // Fail open - allow request if Redis is down
         next();
       }
     };
   };

   // Preset rate limiters per <Resources.pdf> specs
   export const unauthenticatedLimiter = rateLimiter({
     windowMs: 60 * 1000, // 1 minute
     maxRequests: 30,
   });

   export const authenticatedLimiter = rateLimiter({
     windowMs: 60 * 1000, // 1 minute
     maxRequests: 120,
   });

   export const strictLimiter = rateLimiter({
     windowMs: 24 * 60 * 60 * 1000, // 1 day
     maxRequests: 10, // For creating reports
   });