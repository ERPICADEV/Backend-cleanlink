import { Router } from 'express';
import { 
  createComment, 
  getComments, 
  updateComment, 
  deleteComment 
} from '../controllers/commentController';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { commentAuthorMiddleware } from '../middleware/commentMiddleware';
import { authenticatedLimiter } from '../middleware/rateLimiter';

const router = Router();

// Report comments
router.post('/:id/comments', authMiddleware, authenticatedLimiter, createComment);
router.get('/:id/comments', optionalAuthMiddleware, getComments);

// Comment management (separate routes for comment operations)
router.patch('/comments/:id', authMiddleware, commentAuthorMiddleware, authenticatedLimiter, updateComment);
router.delete('/comments/:id', authMiddleware, commentAuthorMiddleware, authenticatedLimiter, deleteComment);

export default router;