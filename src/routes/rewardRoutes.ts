import { Router } from 'express';
import { 
  getRewards, 
  redeemReward, 
  createReward, 
  updateReward, 
  deleteReward 
} from '../controllers/rewardController';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminMiddleware';
import { authenticatedLimiter } from '../middleware/rateLimiter';

const router = Router();

// Public
router.get('/', getRewards);

// User routes
router.post('/:id/redeem', authMiddleware, authenticatedLimiter, redeemReward);

// Admin routes
router.post('/', authMiddleware, adminMiddleware, authenticatedLimiter, createReward);
router.patch('/:id', authMiddleware, adminMiddleware, authenticatedLimiter, updateReward);
router.delete('/:id', authMiddleware, adminMiddleware, authenticatedLimiter, deleteReward);

export default router;