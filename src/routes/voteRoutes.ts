import { Router } from 'express';
import { voteReport } from '../controllers/voteController';
import { authMiddleware } from '../middleware/auth';
import { authenticatedLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/:id/vote', authMiddleware, authenticatedLimiter, voteReport);

export default router;