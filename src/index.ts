// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { redis } from './config/redis';
import { authMiddleware } from './middleware/auth';
import { adminMiddleware } from './middleware/adminRoles';
import { getRolePermissions } from './lib/permissions';
// Import routes
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import reportRoutes from './routes/reportRoutes';
import voteRoutes from './routes/voteRoutes';
import commentRoutes from './routes/commentRoutes';
import adminRoutes from './routes/adminRoutes';
import rewardRoutes from './routes/rewardRoutes';
import aiRoutes from './routes/aiRoutes';
import notificationRoutes from './routes/notificationRoutes';
import mapRoutes from './routes/mapRoutes';

// Check critical environment variables
if (!process.env.DATABASE_URL) {
  console.warn('⚠️  WARNING: DATABASE_URL is not set in environment variables');
}

// Import after dotenv.config() to ensure env vars are loaded
import './utils/queue';
import { pool } from './config/postgres';

// Add error handlers for database connection
pool.on('error', (err: Error & { code?: string }) => {
  console.error('❌ Unexpected PostgreSQL pool error:', err);
  console.error('Error details:', {
    code: err.code,
    message: err.message,
    name: err.name
  });
});

pool.on('connect', (client) => {
  console.log('✅ PostgreSQL client connected');
});

pool.on('acquire', () => {
  // Connection acquired from pool
});

pool.on('remove', () => {
  // Connection removed from pool
});

// Test database connection on startup
async function testDatabaseConnection() {
  try {
    const result = await pool.query('SELECT NOW() as current_time');
    console.log('✅ Database connection test successful:', result.rows[0].current_time);
  } catch (error: any) {
    console.error('❌ Database connection test failed:', {
      code: error.code,
      message: error.message,
      name: error.name
    });
    console.error('⚠️  Server will start but database operations may fail');
  }
}

// Test connection after a short delay to allow pool to initialize
setTimeout(() => {
  testDatabaseConnection();
}, 1000);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/reports', voteRoutes);
app.use('/api/v1/reports', commentRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/rewards', rewardRoutes);
app.use('/internal/ai', aiRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/map', mapRoutes);

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
    await pool.query('SELECT 1');
    
    // Test Redis connection
    await redis.ping();
    
    res.json({ 
      status: 'ok', 
      service: 'cleanlink-api',
      database: 'connected (PostgreSQL)',
      redis: 'connected'
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      service: 'cleanlink-api',
      error: 'Service unavailable'
    });
  }
});

// Test endpoint - add after other routes
app.get('/test-permissions', authMiddleware, adminMiddleware, (req, res) => {
  res.json({
    userId: req.userId,
    adminId: req.adminId,
    role: req.adminRole,
    isSuperAdmin: req.isSuperAdmin,
    permissions: getRolePermissions(req.adminRole!)
  });
});


// Debug endpoint to see all admins
app.get('/debug/admins', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Debug routes
app.get('/debug/queue-status', async (req, res) => {
  try {
    const queueLength = await redis.llen('ai_processing_queue');
    res.json({
      queue_system: 'active',
      pending_jobs: queueLength,
      redis_connected: true
    });
  } catch (error) {
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
    const { processReportWithAI } = await import('./workers/aiWorker');
    await processReportWithAI(req.params.reportId);
    res.json({ 
      message: 'AI processing triggered manually',
      report_id: req.params.reportId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      error: 'Failed to trigger AI',
      details: message
    });
  }
});

app.post('/debug/add-to-queue/:reportId', async (req, res) => {
  try {
    const { enqueueAIAnalysis } = await import('./utils/queue');
    await enqueueAIAnalysis(req.params.reportId);
    res.json({ 
      message: 'Report added to AI queue manually',
      report_id: req.params.reportId
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to add to queue',
      details: error.message
    });
  }
});

// Global error handler middleware - must be after all routes
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
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
app.use((req: express.Request, res: express.Response) => {
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