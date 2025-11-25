import { Router } from 'express';
import { 
  getReports, 
  createReport, 
  getReport, 
  updateReport 
} from '../controllers/reportController';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { adminMiddleware, reporterOrAdminMiddleware } from '../middleware/adminMiddleware';
import { authenticatedLimiter, strictLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/', optionalAuthMiddleware, getReports);
router.post('/', authMiddleware, strictLimiter, createReport);
router.get('/:id', optionalAuthMiddleware, getReport);
router.patch('/:id', authMiddleware, reporterOrAdminMiddleware, updateReport);

// Admin only routes (to be added later)
// router.get('/admin/reports', authMiddleware, adminMiddleware, getAdminReports);
// router.patch('/admin/reports/:id/assign', authMiddleware, adminMiddleware, assignReport);
// router.patch('/admin/reports/:id/resolve', authMiddleware, adminMiddleware, resolveReport);

export default router;