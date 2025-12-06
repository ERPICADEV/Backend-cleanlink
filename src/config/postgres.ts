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
  ssl: databaseUrl?.includes('localhost') || databaseUrl?.includes('127.0.0.1') ? false : {
    rejectUnauthorized: false,
  },
  // Connection pool settings optimized for Render
  max: 10, // Maximum number of clients in the pool
  min: 2, // Minimum number of clients in the pool (keeps connections warm)
  // Increased timeout for Render databases that may sleep
  connectionTimeoutMillis: isRender ? 15000 : 5000, // 15s for Render, 5s for local
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  // Keep connections alive to prevent Render from closing idle connections
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000, // Start keepalive after 10 seconds
});

