import { Router } from 'express';
import { getMe, updateMe, getPublicProfile, getRegions, updateRegion } from '../controllers/userController';
import { authMiddleware } from '../middleware/auth';
import { authenticatedLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/me', authMiddleware, authenticatedLimiter, getMe);
router.patch('/me', authMiddleware, authenticatedLimiter, updateMe);
router.patch('/me/region', authMiddleware, authenticatedLimiter, updateRegion);
router.get('/regions', getRegions); // Public
router.get('/:id/public', getPublicProfile); // Public

export default router;