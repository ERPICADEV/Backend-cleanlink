"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.warmUpPool = warmUpPool;
const pg_1 = require("pg");
// Get DATABASE_URL from environment
const databaseUrl = process.env.DATABASE_URL;
// ================================
// Performance logging (easy to remove)
// Enable with: PERF_LOGGING=1
// Logs: PostgreSQL queries slower than 100ms (query text only, no params)
// ================================
const PERF_LOGGING_ENABLED = process.env.PERF_LOGGING === '1';
const SLOW_QUERY_THRESHOLD_MS = 100;
if (!databaseUrl) {
    console.warn('⚠️  WARNING: DATABASE_URL is not set. Database connections will fail.');
    console.warn('   Make sure DATABASE_URL is in your .env file and dotenv.config() is called before importing this module.');
}
else {
    console.log('✅ DATABASE_URL found:', databaseUrl.replace(/:[^:@]+@/, ':****@')); // Mask password
}
// Determine if we're on Render (production)
const isRender = process.env.RENDER || databaseUrl?.includes('render.com') || databaseUrl?.includes('onrender.com');
exports.pool = new pg_1.Pool({
    connectionString: databaseUrl,
    // Enable SSL for all non-localhost connections (required for Render)
    ssl: databaseUrl && !databaseUrl.includes('localhost') && !databaseUrl.includes('127.0.0.1') ? {
        rejectUnauthorized: false,
    } : false,
    // Connection pool settings optimized for Render
    max: isRender ? 15 : 10, // More connections for Render to handle concurrent requests
    min: isRender ? 2 : 2, // Keep some warm connections even on Render
    // Increased timeout for Render databases that may sleep
    connectionTimeoutMillis: isRender ? 30000 : 5000, // 30s for Render (more time for wake-up), 5s for local
    idleTimeoutMillis: isRender ? 90000 : 30000, // 90s for Render (longer idle timeout), 30s for local
    // Keep connections alive to prevent Render from closing idle connections
    keepAlive: true,
    keepAliveInitialDelayMillis: isRender ? 5000 : 10000, // Start keepalive sooner on Render
});
// Wrap pool.query (and pool.connect().client.query) to log slow queries.
// This does NOT change query behavior/results; it only measures duration.
if (PERF_LOGGING_ENABLED) {
    const originalPoolQuery = exports.pool.query.bind(exports.pool);
    const logIfSlow = (durationMs, text) => {
        if (durationMs <= SLOW_QUERY_THRESHOLD_MS)
            return;
        const sql = (text || '').replace(/\s+/g, ' ').trim();
        const truncated = sql.length > 500 ? `${sql.slice(0, 500)}…` : sql;
        console.warn(`[perf] pg slow_query ${durationMs.toFixed(1)}ms ${truncated}`);
    };
    exports.pool.query = async (...args) => {
        const queryText = typeof args[0] === 'string' ? args[0] : args[0]?.text;
        const start = process.hrtime.bigint();
        try {
            return await originalPoolQuery(...args);
        }
        finally {
            const durationMs = Number(process.hrtime.bigint() - start) / 1000000;
            logIfSlow(durationMs, queryText);
        }
    };
    const originalConnect = exports.pool.connect.bind(exports.pool);
    exports.pool.connect = async (...args) => {
        const client = await originalConnect(...args);
        const originalClientQuery = client.query.bind(client);
        client.query = async (...qArgs) => {
            const queryText = typeof qArgs[0] === 'string' ? qArgs[0] : qArgs[0]?.text;
            const start = process.hrtime.bigint();
            try {
                return await originalClientQuery(...qArgs);
            }
            finally {
                const durationMs = Number(process.hrtime.bigint() - start) / 1000000;
                logIfSlow(durationMs, queryText);
            }
        };
        return client;
    };
}
// Add connection validation to catch stale connections
exports.pool.on('error', (err) => {
    console.error('❌ PostgreSQL pool error:', {
        code: err.code,
        message: err.message,
        name: err.name
    });
});
// Warm up the connection pool on startup (especially important for Render)
let poolWarmedUp = false;
async function warmUpPool() {
    if (poolWarmedUp)
        return;
    try {
        console.log('🔥 Warming up database connection pool...');
        // Use pool.query() instead of pool.connect() to warm up the pool
        await exports.pool.query('SELECT 1');
        console.log('✅ Database pool warmed up successfully');
        poolWarmedUp = true;
    }
    catch (error) {
        console.error('⚠️  Failed to warm up database pool:', {
            code: error.code,
            message: error.message
        });
        // Don't throw - let the app start and connections will be established on demand
        poolWarmedUp = false;
    }
}
// Auto-warm up after a delay to allow the app to start
if (isRender) {
    setTimeout(() => {
        warmUpPool().catch(err => {
            console.error('Pool warm-up error:', err);
        });
    }, 2000); // Wait 2 seconds after startup
}
