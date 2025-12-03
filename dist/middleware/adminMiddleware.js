"use strict";
// src/middleware/adminRoles.ts
// 🔐 Admin Role & Permission Middleware
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.noViewerAccess = exports.assignedReportsOnly = exports.canAccessReport = exports.requirePermission = exports.superAdminOnly = exports.adminMiddleware = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const permissions_1 = require("../lib/permissions");
/**
 * Middleware: Check if user is an admin (any role)
 * Adds admin info to request object
 */
const adminMiddleware = async (req, res, next) => {
    try {
        if (!req.userId) {
            return res.status(401).json({
                error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            });
        }
        const stmt = sqlite_1.default.prepare('SELECT id, role, status FROM admins WHERE user_id = ?');
        const admin = stmt.get(req.userId);
        if (!admin) {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            });
        }
        // Check if admin is active
        if (admin.status !== 'active') {
            return res.status(403).json({
                error: {
                    code: 'FORBIDDEN',
                    message: `Admin account is ${admin.status}. Contact super admin.`
                },
            });
        }
        // Attach admin info to request
        req.adminRole = admin.role;
        req.adminId = admin.id;
        req.isAdmin = true;
        req.isSuperAdmin = admin.role === permissions_1.AdminRole.SUPERADMIN;
        next();
    }
    catch (error) {
        console.error('Admin middleware error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
        });
    }
};
exports.adminMiddleware = adminMiddleware;
/**
 * Middleware: Only SuperAdmin can pass
 */
const superAdminOnly = (req, res, next) => {
    if (req.adminRole !== permissions_1.AdminRole.SUPERADMIN) {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'SuperAdmin access required for this action',
            },
        });
    }
    next();
};
exports.superAdminOnly = superAdminOnly;
/**
 * Middleware: Check specific permission
 * Usage: requirePermission('ASSIGN_REPORTS')
 */
const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.adminRole) {
            return res.status(401).json({
                error: { code: 'UNAUTHORIZED', message: 'Admin role not found' },
            });
        }
        if (!(0, permissions_1.hasPermission)(req.adminRole, permission)) {
            return res.status(403).json({
                error: {
                    code: 'FORBIDDEN',
                    message: `Permission denied: ${permission}`,
                    details: `Your role (${req.adminRole}) does not have this permission`,
                },
            });
        }
        next();
    };
};
exports.requirePermission = requirePermission;
/**
 * Middleware: Add helper function to check report access
 * SuperAdmin can access all, Admin can only access assigned reports
 */
const canAccessReport = (req, res, next) => {
    // Add helper function to request object
    req.canAccessReport = async (reportId) => {
        // SuperAdmin can access all reports
        if (req.isSuperAdmin)
            return true;
        // Check if report is assigned to this admin
        const stmt = sqlite_1.default.prepare(`
      SELECT admin_id FROM report_progress 
      WHERE report_id = ? AND admin_id = ?
    `);
        const result = stmt.get(reportId, req.adminId);
        return !!result;
    };
    next();
};
exports.canAccessReport = canAccessReport;
/**
 * Middleware: Ensure admin can only access their assigned reports
 * Use this on endpoints where admin should only see their work
 */
const assignedReportsOnly = async (req, res, next) => {
    try {
        const reportId = req.params.id || req.params.reportId;
        if (!reportId) {
            return res.status(400).json({
                error: { code: 'BAD_REQUEST', message: 'Report ID required' },
            });
        }
        // SuperAdmin can access all
        if (req.isSuperAdmin) {
            return next();
        }
        // Check if report is assigned to this admin
        const stmt = sqlite_1.default.prepare(`
      SELECT id FROM report_progress 
      WHERE report_id = ? AND admin_id = ?
    `);
        const assignment = stmt.get(reportId, req.adminId);
        if (!assignment) {
            return res.status(403).json({
                error: {
                    code: 'FORBIDDEN',
                    message: 'This report is not assigned to you',
                },
            });
        }
        next();
    }
    catch (error) {
        console.error('Assigned reports check error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
        });
    }
};
exports.assignedReportsOnly = assignedReportsOnly;
/**
 * Middleware: Block viewers from taking actions
 * Viewers can only view, not modify
 */
const noViewerAccess = (req, res, next) => {
    if (req.adminRole === permissions_1.AdminRole.VIEWER) {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Viewers cannot perform this action. Read-only access.',
            },
        });
    }
    next();
};
exports.noViewerAccess = noViewerAccess;
