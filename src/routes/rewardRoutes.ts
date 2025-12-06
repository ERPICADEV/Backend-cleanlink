import { Router } from 'express';
import { 
  getRewards, 
  getAllRewards,
  redeemReward, 
  createReward, 
  updateReward, 
  deleteReward 
} from '../controllers/rewardController';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware, requirePermission } from '../middleware/adminMiddleware';

const router = Router();

// Public endpoint - returns only available rewards
router.get('/', getRewards);
// Admin endpoint - returns all rewards (including unavailable)
router.get('/admin/all', authMiddleware, adminMiddleware, requirePermission('MANAGE_REWARDS'), getAllRewards);
router.post('/:id/redeem', authMiddleware, redeemReward);
// CRUD endpoints - require MANAGE_REWARDS permission (superadmin only)
router.post('/', authMiddleware, adminMiddleware, requirePermission('MANAGE_REWARDS'), createReward);
router.patch('/:id', authMiddleware, adminMiddleware, requirePermission('MANAGE_REWARDS'), updateReward);
router.delete('/:id', authMiddleware, adminMiddleware, requirePermission('MANAGE_REWARDS'), deleteReward);

export default router;