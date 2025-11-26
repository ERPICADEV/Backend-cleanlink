import { Router } from 'express';
import { 
  getReports, 
  createReport, 
  getReport, 
  updateReport 
} from '../controllers/reportController-sqlite'; // New SQLite versions
import { authMiddleware } from '../middleware/auth';

const router = Router();

// SQLite endpoints
router.get('/', getReports);
router.post('/', authMiddleware, createReport);
router.get('/:id', getReport);
router.patch('/:id', authMiddleware, updateReport);

export default router;