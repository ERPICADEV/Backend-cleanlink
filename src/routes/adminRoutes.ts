// src/routes/adminRoutes.ts
// REPLACE ENTIRE FILE with this updated version

import { Router } from 'express';
import { 
  getAdminReports,  
  getAssignedReports,
  assignReport, 
  resolveReport,
  updateReportProgress,
  submitForApproval,
  getPendingApprovals,
  approveReportWork,
  rejectReportWork,
  getReportAuditLogs,
  getAdminUsers,
  getAdminStats
} from '../controllers/adminController';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware, superAdminOnly } from '../middleware/adminMiddleware';

const router = Router();

// All routes require authentication + admin role
router.use(authMiddleware, adminMiddleware);

// ==================== SUPERADMIN ONLY ROUTES ====================
// View all reports
router.get('/reports', superAdminOnly, getAdminReports);

// Assignment & Resolution
router.patch('/reports/:id/assign', superAdminOnly, assignReport);

// Approval workflow
router.get('/pending-approvals', superAdminOnly, getPendingApprovals);
router.patch('/reports/:id/approve', superAdminOnly, approveReportWork);
router.patch('/reports/:id/reject', superAdminOnly, rejectReportWork);

// Stats & Users
router.get('/stats', superAdminOnly, getAdminStats);
router.get('/users', superAdminOnly, getAdminUsers);

// ==================== FIELD ADMIN (ADMIN ROLE) ROUTES ====================
// View assigned reports only
router.get('/reports/assigned', getAssignedReports);

// Work progress updates
router.patch('/reports/:id/progress', updateReportProgress);

// Submit completed work
router.patch('/reports/:id/submit-approval', submitForApproval);

// ==================== BOTH ROLES CAN ACCESS ====================
// Audit logs
router.get('/audit/reports/:id', getReportAuditLogs);

// Legacy resolve endpoint (SuperAdmin only) - keeping for backward compatibility
router.patch('/reports/:id/resolve', superAdminOnly, resolveReport);

export default router;