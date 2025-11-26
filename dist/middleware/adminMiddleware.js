"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reporterOrAdminMiddleware = exports.adminMiddleware = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const adminMiddleware = async (req, res, next) => {
    try {
        if (!req.userId) {
            return res.status(401).json({
                error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            });
        }
        const stmt = sqlite_1.default.prepare('SELECT * FROM admins WHERE userId = ?');
        const admin = stmt.get(req.userId);
        if (!admin) {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Admin access required' },
            });
        }
        req.isAdmin = true;
        req.adminRole = admin.role;
        req.adminRegion = admin.regionAssigned;
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
const reporterOrAdminMiddleware = async (req, res, next) => {
    try {
        const { id } = req.params;
        const stmt = sqlite_1.default.prepare('SELECT reporterId FROM reports WHERE id = ?');
        const report = stmt.get(id);
        if (!report) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        // Check if user is reporter or admin
        const isReporter = report.reporterId === req.userId;
        const adminStmt = sqlite_1.default.prepare('SELECT * FROM admins WHERE userId = ?');
        const isAdmin = adminStmt.get(req.userId);
        if (!isReporter && !isAdmin) {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Not authorized to modify this report' },
            });
        }
        req.isReporter = isReporter;
        req.isAdmin = !!isAdmin;
        next();
    }
    catch (error) {
        console.error('ReporterOrAdmin middleware error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
        });
    }
};
exports.reporterOrAdminMiddleware = reporterOrAdminMiddleware;
