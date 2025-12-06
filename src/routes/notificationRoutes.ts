import { Router } from 'express';
import { 
  getNotifications, 
  getUnreadCount,
  markAsRead
} from '../controllers/notificationController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', authMiddleware, getNotifications);
router.get('/unread-count', authMiddleware, getUnreadCount);
router.patch('/:id/read', authMiddleware, markAsRead);

export default router;