import { Router } from 'express';
import { 
  updateAIResult, 
  getPendingAIReports 
} from '../controllers/aiController';

const router = Router();

router.post('/reports/:id/result', updateAIResult);
router.get('/reports/pending', getPendingAIReports);

export default router;