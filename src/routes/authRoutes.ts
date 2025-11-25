import { Router } from 'express';
   import { signup, login, refreshTokenHandler } from '../controllers/authController';
   import { unauthenticatedLimiter } from '../middleware/rateLimiter';

   const router = Router();

   router.post('/signup', unauthenticatedLimiter, signup);
   router.post('/login', unauthenticatedLimiter, login);
   router.post('/refresh', unauthenticatedLimiter, refreshTokenHandler);

   export default router;