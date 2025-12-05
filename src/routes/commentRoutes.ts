import { Router } from 'express';
import { 
  createComment, 
  getComments, 
  updateComment, 
  deleteComment 
} from '../controllers/commentController-sqlite';
import { voteComment, getCommentVote } from '../controllers/commentVoteController-sqlite';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { authenticatedLimiter } from '../middleware/rateLimiter';

const router = Router();

// SQLite endpoints
router.post('/:id/comments', authMiddleware, createComment);
router.get('/:id/comments', optionalAuthMiddleware, getComments);
router.patch('/comments/:id', authMiddleware, updateComment);
router.delete('/comments/:id', authMiddleware, deleteComment);

// Comment voting endpoints
router.post('/comments/:id/vote', authMiddleware, authenticatedLimiter, voteComment);
router.get('/comments/:id/vote', authMiddleware, getCommentVote);

export default router;