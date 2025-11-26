import { Router } from 'express';
import { 
  getAdminReports, 
  assignReport, 
  resolveReport, 
  getReportAuditLogs 
} from '../controllers/adminController-sqlite';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminMiddleware';

const router = Router();

// SQLite endpoints
router.get('/reports', authMiddleware, adminMiddleware, getAdminReports);
router.patch('/reports/:id/assign', authMiddleware, adminMiddleware, assignReport);
router.patch('/reports/:id/resolve', authMiddleware, adminMiddleware, resolveReport);
router.get('/audit/reports/:id', authMiddleware, adminMiddleware, getReportAuditLogs);

export default router;