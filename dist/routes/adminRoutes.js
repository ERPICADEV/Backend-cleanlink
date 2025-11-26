"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adminController_sqlite_1 = require("../controllers/adminController-sqlite");
const auth_1 = require("../middleware/auth");
const adminMiddleware_1 = require("../middleware/adminMiddleware");
const router = (0, express_1.Router)();
// SQLite endpoints
router.get('/reports', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, adminController_sqlite_1.getAdminReports);
router.patch('/reports/:id/assign', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, adminController_sqlite_1.assignReport);
router.patch('/reports/:id/resolve', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, adminController_sqlite_1.resolveReport);
router.get('/audit/reports/:id', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, adminController_sqlite_1.getReportAuditLogs);
exports.default = router;
