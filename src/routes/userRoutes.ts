import { Router } from 'express';
import { 
  getMe, 
  updateMe, 
  getPublicProfile, 
  getRegions, 
  updateRegion,
  getMyComments
} from '../controllers/userController-sqlite';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// SQLite endpoints
router.get('/me', authMiddleware, getMe);
router.patch('/me', authMiddleware, updateMe);
router.get('/me/comments', authMiddleware, getMyComments);
router.get('/:id/public', getPublicProfile);
router.get('/regions', getRegions);
router.patch('/me/region', authMiddleware, updateRegion);

export default router;