import { Router } from 'express';
import { updateAIResult, getPendingAIReports } from '../controllers/aiController';
import { apiKeyMiddleware } from '../middleware/apiKeyMiddleware';

const router = Router();

// Protect all AI routes with API key
router.use(apiKeyMiddleware);

router.post('/reports/:id/result', updateAIResult);
router.get('/reports/pending', getPendingAIReports);

export default router;