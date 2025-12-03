"use strict";
// src/routes/adminRoutes.ts
// REPLACE ENTIRE FILE with this updated version
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adminController_sqlite_1 = require("../controllers/adminController-sqlite");
const auth_1 = require("../middleware/auth");
const adminMiddleware_1 = require("../middleware/adminMiddleware");
const router = (0, express_1.Router)();
// All routes require authentication + admin role
router.use(auth_1.authMiddleware, adminMiddleware_1.adminMiddleware);
// ==================== SUPERADMIN ONLY ROUTES ====================
// View all reports
router.get('/reports', adminMiddleware_1.superAdminOnly, adminController_sqlite_1.getAdminReports);
// Assignment & Resolution
router.patch('/reports/:id/assign', adminMiddleware_1.superAdminOnly, adminController_sqlite_1.assignReport);
// Approval workflow
router.get('/pending-approvals', adminMiddleware_1.superAdminOnly, adminController_sqlite_1.getPendingApprovals);
router.patch('/reports/:id/approve', adminMiddleware_1.superAdminOnly, adminController_sqlite_1.approveReportWork);
router.patch('/reports/:id/reject', adminMiddleware_1.superAdminOnly, adminController_sqlite_1.rejectReportWork);
// Stats & Users
router.get('/stats', adminMiddleware_1.superAdminOnly, adminController_sqlite_1.getAdminStats);
router.get('/users', adminMiddleware_1.superAdminOnly, adminController_sqlite_1.getAdminUsers);
// ==================== FIELD ADMIN (ADMIN ROLE) ROUTES ====================
// View assigned reports only
router.get('/reports/assigned', adminController_sqlite_1.getAssignedReports);
// Work progress updates
router.patch('/reports/:id/progress', adminController_sqlite_1.updateReportProgress);
// Submit completed work
router.patch('/reports/:id/submit-approval', adminController_sqlite_1.submitForApproval);
// ==================== BOTH ROLES CAN ACCESS ====================
// Audit logs
router.get('/audit/reports/:id', adminController_sqlite_1.getReportAuditLogs);
// Legacy resolve endpoint (SuperAdmin only) - keeping for backward compatibility
router.patch('/reports/:id/resolve', adminMiddleware_1.superAdminOnly, adminController_sqlite_1.resolveReport);
exports.default = router;
