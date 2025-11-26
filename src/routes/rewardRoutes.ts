import { Router } from 'express';
import { 
  getRewards, 
  redeemReward, 
  createReward, 
  updateReward, 
  deleteReward 
} from '../controllers/rewardController-sqlite';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminMiddleware';

const router = Router();

// SQLite endpoints
router.get('/', getRewards);
router.post('/:id/redeem', authMiddleware, redeemReward);
router.post('/', authMiddleware, adminMiddleware, createReward);
router.patch('/:id', authMiddleware, adminMiddleware, updateReward);
router.delete('/:id', authMiddleware, adminMiddleware, deleteReward);

export default router;