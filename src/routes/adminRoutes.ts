import { Router } from 'express';
import { 
  getAdminReports, 
  assignReport, 
  resolveReport, 
  getReportAuditLogs 
} from '../controllers/adminController';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminMiddleware';
import { authenticatedLimiter } from '../middleware/rateLimiter';

const router = Router();

// All admin routes require authentication and admin privileges
router.use(authMiddleware);
router.use(adminMiddleware);
router.use(authenticatedLimiter);

router.get('/reports', getAdminReports);
router.patch('/reports/:id/assign', assignReport);
router.patch('/reports/:id/resolve', resolveReport);
router.get('/audit/reports/:id', getReportAuditLogs);

export default router;