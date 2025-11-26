import { Router } from 'express';
import { 
  createComment, 
  getComments, 
  updateComment, 
  deleteComment 
} from '../controllers/commentController-sqlite';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// SQLite endpoints
router.post('/:id/comments', authMiddleware, createComment);
router.get('/:id/comments', getComments);
router.patch('/comments/:id', authMiddleware, updateComment);
router.delete('/comments/:id', authMiddleware, deleteComment);

export default router;