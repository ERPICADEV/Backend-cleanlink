import { Router } from 'express';
import { 
  updateAIResult, 
  getPendingAIReports 
} from '../controllers/aiController-sqlite';

const router = Router();

// SQLite endpoints
router.post('/reports/:id/result', updateAIResult);
router.get('/reports/pending', getPendingAIReports);

export default router;