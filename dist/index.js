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
// Load environment variables FIRST before any other imports
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const redis_1 = require("./config/redis");
const auth_1 = require("./middleware/auth");
const adminRoles_1 = require("./middleware/adminRoles");
const permissions_1 = require("./lib/permissions");
// Import routes
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
const path_1 = __importDefault(require("path"));
// Check critical environment variables
if (!process.env.DATABASE_URL) {
    console.warn('⚠️  WARNING: DATABASE_URL is not set in environment variables');
}
// Import after dotenv.config() to ensure env vars are loaded
require("./utils/queue");
const postgres_1 = require("./config/postgres");
// Add error handlers for database connection
postgres_1.pool.on('error', (err) => {
    console.error('❌ Unexpected PostgreSQL pool error:', err);
    console.error('Error details:', {
        code: err.code,
        message: err.message,
        name: err.name
    });
});
postgres_1.pool.on('connect', (client) => {
    console.log('✅ PostgreSQL client connected');
});
postgres_1.pool.on('acquire', () => {
    // Connection acquired from pool
});
postgres_1.pool.on('remove', () => {
    // Connection removed from pool
});
// Test database connection on startup
async function testDatabaseConnection() {
    try {
        const result = await postgres_1.pool.query('SELECT NOW() as current_time');
        console.log('✅ Database connection test successful:', result.rows[0].current_time);
    }
    catch (error) {
        console.error('❌ Database connection test failed:', {
            code: error.code,
            message: error.message,
            name: error.name
        });
        console.error('⚠️  Server will start but database operations may fail');
    }
}
// Test connection and warm up pool after a short delay to allow pool to initialize
setTimeout(async () => {
    await testDatabaseConnection();
    // Also warm up the pool
    await (0, postgres_1.warmUpPool)();
}, 1000);
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// ================================
// Performance logging (easy to remove)
// Enable with: PERF_LOGGING=1
// Logs: method + path + duration (ms)
// ================================
const PERF_LOGGING_ENABLED = process.env.PERF_LOGGING === '1';
if (PERF_LOGGING_ENABLED) {
    app.use((req, res, next) => {
        const start = process.hrtime.bigint();
        res.on('finish', () => {
            const durationMs = Number(process.hrtime.bigint() - start) / 1000000;
            // Use a stable path without query string; method + path is what you asked for
            const path = (req.originalUrl || req.url || '').split('?')[0] || req.path;
            console.log(`[perf] api ${req.method} ${path} ${durationMs.toFixed(1)}ms`);
        });
        next();
    });
}
// Helmet with relaxed cross-origin resource policy so frontend (8081) can load images from API (3000)
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// Serve uploaded images (local storage)
app.use('/uploads', express_1.default.static(path_1.default.resolve(process.cwd(), 'uploads'), {
    maxAge: '7d',
    etag: true,
    immutable: false,
}));
// API Routes
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
// Root route - friendly message
app.get('/', (req, res) => {
    res.json({
        message: 'Welcome to CleanLink API',
        service: 'cleanlink-api',
        version: 'v1',
        status: 'ok',
        endpoints: {
            api: '/api/v1',
            health: '/health'
        },
        documentation: 'Visit /api/v1 for available API routes'
    });
});
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
// Health check
app.get('/health', async (req, res) => {
    try {
        // Test PostgreSQL connection
        await postgres_1.pool.query('SELECT 1');
        // Test Redis connection
        await redis_1.redis.ping();
        res.json({
            status: 'ok',
            service: 'cleanlink-api',
            database: 'connected (PostgreSQL)',
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
app.get('/debug/admins', auth_1.authMiddleware, adminRoles_1.adminMiddleware, async (req, res) => {
    try {
        const result = await postgres_1.pool.query(`
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
        res.json(result.rows);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Debug routes
app.get('/debug/queue-status', async (req, res) => {
    try {
        const queueLength = await redis_1.redis.llen('ai_processing_queue');
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
// Global error handler middleware - must be after all routes
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    // Check if it's a database connection error
    const isDbError = err.code === 'ECONNREFUSED' ||
        err.code === 'ENOTFOUND' ||
        err.code === 'ETIMEDOUT' ||
        err.message?.toLowerCase().includes('connection') ||
        err.message?.toLowerCase().includes('database') ||
        err.message?.toLowerCase().includes('postgres');
    if (isDbError) {
        return res.status(503).json({
            error: {
                code: 'DATABASE_UNAVAILABLE',
                message: 'Database connection unavailable. Please try again later.',
            }
        });
    }
    // Check if it's a Redis connection error
    const isRedisError = err.message?.toLowerCase().includes('redis') ||
        err.message?.toLowerCase().includes('connection refused');
    if (isRedisError) {
        return res.status(503).json({
            error: {
                code: 'REDIS_UNAVAILABLE',
                message: 'Cache service unavailable. Please try again later.',
            }
        });
    }
    // Default error response
    res.status(err.status || 500).json({
        error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message || 'An unexpected error occurred',
        }
    });
});
// 404 handler - must be after all routes and error handler
app.use((req, res) => {
    res.status(404).json({
        error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${req.path} not found`,
        }
    });
});
// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    console.log(`📚 API: http://localhost:${PORT}/api/v1`);
});
