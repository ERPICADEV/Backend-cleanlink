import { Pool } from "pg";

// Get DATABASE_URL from environment
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn('⚠️  WARNING: DATABASE_URL is not set. Database connections will fail.');
  console.warn('   Make sure DATABASE_URL is in your .env file and dotenv.config() is called before importing this module.');
} else {
  console.log('✅ DATABASE_URL found:', databaseUrl.replace(/:[^:@]+@/, ':****@')); // Mask password
}

// Determine if we're on Render (production)
const isRender = process.env.RENDER || databaseUrl?.includes('render.com') || databaseUrl?.includes('onrender.com');

export const pool = new Pool({
  connectionString: databaseUrl,
  // Enable SSL for all non-localhost connections (required for Render)
  ssl: databaseUrl && !databaseUrl.includes('localhost') && !databaseUrl.includes('127.0.0.1') ? {
    rejectUnauthorized: false,
  } : false,
  // Connection pool settings optimized for Render
  max: 10, // Maximum number of clients in the pool
  min: isRender ? 1 : 2, // Lower min for Render to avoid connection issues on sleep
  // Increased timeout for Render databases that may sleep
  connectionTimeoutMillis: isRender ? 20000 : 5000, // 20s for Render (more time for wake-up), 5s for local
  idleTimeoutMillis: isRender ? 60000 : 30000, // 60s for Render, 30s for local
  // Keep connections alive to prevent Render from closing idle connections
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000, // Start keepalive after 10 seconds
});

// Add connection validation to catch stale connections
pool.on('error', (err: Error & { code?: string }) => {
  console.error('❌ PostgreSQL pool error:', {
    code: err.code,
    message: err.message,
    name: err.name
  });
});

// Warm up the connection pool on startup (especially important for Render)
let poolWarmedUp = false;

export async function warmUpPool() {
  if (poolWarmedUp) return;
  
  try {
    console.log('🔥 Warming up database connection pool...');
    // Use pool.query() instead of pool.connect() to warm up the pool
    await pool.query('SELECT 1');
    console.log('✅ Database pool warmed up successfully');
    poolWarmedUp = true;
  } catch (error: any) {
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

