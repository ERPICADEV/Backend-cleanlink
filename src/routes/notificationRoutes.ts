import { Router } from 'express';
import { getNotifications, getUnreadCount } from '../controllers/notificationController';
import { authMiddleware } from '../middleware/auth';
import { authenticatedLimiter } from '../middleware/rateLimiter';

const router = Router();

router.use(authMiddleware);
router.use(authenticatedLimiter);

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);

export default router;