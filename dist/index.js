"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const dotenv_1 = __importDefault(require("dotenv"));
const redis_1 = __importDefault(require("./config/redis"));
const auth_1 = require("./middleware/auth");
const adminRoles_1 = require("./middleware/adminRoles");
const permissions_1 = require("./lib/permissions");
// Import SQLite routes
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const reportRoutes_1 = __importDefault(require("./routes/reportRoutes"));
const voteRoutes_1 = __importDefault(require("./routes/voteRoutes"));
const commentRoutes_1 = __importDefault(require("./routes/commentRoutes"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const rewardRoutes_1 = __importDefault(require("./routes/rewardRoutes"));
const aiRoutes_1 = __importDefault(require("./routes/aiRoutes"));
const notificationRoutes_1 = __importDefault(require("./routes/notificationRoutes"));
const mapRoutes_1 = __importDefault(require("./routes/mapRoutes"));
require("./utils/queue");
const sqlite_1 = __importDefault(require("./config/sqlite"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// SQLite Routes ONLY
app.use('/api/v1/auth', authRoutes_1.default);
app.use('/api/v1/users', userRoutes_1.default);
app.use('/api/v1/reports', reportRoutes_1.default);
app.use('/api/v1/reports', voteRoutes_1.default);
app.use('/api/v1/reports', commentRoutes_1.default);
app.use('/api/v1/admin', adminRoutes_1.default);
app.use('/api/v1/rewards', rewardRoutes_1.default);
app.use('/internal/ai', aiRoutes_1.default);
app.use('/api/v1/notifications', notificationRoutes_1.default);
app.use('/api/v1/map', mapRoutes_1.default);
// Base API index to prevent "Cannot GET /api/v1"
app.get('/api/v1', (req, res) => {
    res.json({
        status: 'ok',
        service: 'cleanlink-api',
        version: 'v1',
        routes: [
            '/api/v1/auth',
            '/api/v1/users',
            '/api/v1/reports',
            '/api/v1/admin',
            '/api/v1/rewards',
            '/api/v1/notifications',
            '/api/v1/map'
        ],
        docs: 'Refer to README or swagger docs (if enabled)'
    });
});
// Health check (SQLite only)
app.get('/health', async (req, res) => {
    try {
        // Test SQLite connection
        sqlite_1.default.prepare('SELECT 1').get();
        // Test Redis connection
        await redis_1.default.ping();
        res.json({
            status: 'ok',
            service: 'cleanlink-api',
            database: 'connected (SQLite)',
            redis: 'connected'
        });
    }
    catch (error) {
        res.status(503).json({
            status: 'error',
            service: 'cleanlink-api',
            error: 'Service unavailable'
        });
    }
});
// SQLite test endpoints
app.get('/sqlite-reports', (req, res) => {
    try {
        const stmt = sqlite_1.default.prepare('SELECT id, title, upvotes, downvotes FROM reports LIMIT 10');
        const reports = stmt.all();
        res.json({
            data: reports,
            count: reports.length,
            message: 'Reports from SQLite database'
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Test endpoint - add after other routes
app.get('/test-permissions', auth_1.authMiddleware, adminRoles_1.adminMiddleware, (req, res) => {
    res.json({
        userId: req.userId,
        adminId: req.adminId,
        role: req.adminRole,
        isSuperAdmin: req.isSuperAdmin,
        permissions: (0, permissions_1.getRolePermissions)(req.adminRole)
    });
});
// Debug endpoint to see all admins
app.get('/debug/admins', auth_1.authMiddleware, adminRoles_1.adminMiddleware, (req, res) => {
    const stmt = sqlite_1.default.prepare(`
    SELECT 
      a.id as admin_id,
      a.user_id,
      a.role,
      a.status,
      u.email,
      u.username
    FROM admins a
    JOIN users u ON a.user_id = u.id
  `);
    const admins = stmt.all();
    res.json(admins);
});
app.get('/sqlite-reports/:id', (req, res) => {
    try {
        const { id } = req.params;
        const stmt = sqlite_1.default.prepare('SELECT * FROM reports WHERE id = ?');
        const report = stmt.get(id);
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        res.json(report);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Debug routes
app.get('/debug/queue-status', async (req, res) => {
    try {
        const queueLength = await redis_1.default.llen('ai_processing_queue');
        res.json({
            queue_system: 'active',
            pending_jobs: queueLength,
            redis_connected: true
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.json({
            queue_system: 'error',
            error: message,
            redis_connected: false
        });
    }
});
app.post('/debug/trigger-ai/:reportId', async (req, res) => {
    try {
        const { processReportWithAI } = await Promise.resolve().then(() => __importStar(require('./workers/aiWorker')));
        await processReportWithAI(req.params.reportId);
        res.json({
            message: 'AI processing triggered manually',
            report_id: req.params.reportId
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({
            error: 'Failed to trigger AI',
            details: message
        });
    }
});
app.post('/debug/add-to-queue/:reportId', async (req, res) => {
    try {
        const { enqueueAIAnalysis } = await Promise.resolve().then(() => __importStar(require('./utils/queue')));
        await enqueueAIAnalysis(req.params.reportId);
        res.json({
            message: 'Report added to AI queue manually',
            report_id: req.params.reportId
        });
    }
    catch (error) {
        res.status(500).json({
            error: 'Failed to add to queue',
            details: error.message
        });
    }
});
// Start server
app.listen(PORT, () => {
    console.log(`🚀 CleanLink API (SQLite) running on port ${PORT}`);
});
