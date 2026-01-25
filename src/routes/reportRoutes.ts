import { Router } from 'express';
import { 
  getReports, 
  createReport, 
  getReport, 
  updateReport,
  getPreSubmissionSuggestions
} from '../controllers/reportController';
import { analyzeReport } from '../controllers/aiController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/', getReports);
router.post('/', authMiddleware, createReport);
router.post('/pre-submission-suggestions', getPreSubmissionSuggestions); // No auth required - optional suggestions
router.post('/analyze-report', analyzeReport); // No auth required - public AI analysis
router.get('/:id', getReport);
router.patch('/:id', authMiddleware, updateReport);

export default router;