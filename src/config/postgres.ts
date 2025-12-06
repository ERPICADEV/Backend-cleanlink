import { Pool } from "pg";

// Get DATABASE_URL from environment
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn('⚠️  WARNING: DATABASE_URL is not set. Database connections will fail.');
  console.warn('   Make sure DATABASE_URL is in your .env file and dotenv.config() is called before importing this module.');
} else {
  console.log('✅ DATABASE_URL found:', databaseUrl.replace(/:[^:@]+@/, ':****@')); // Mask password
}

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl?.includes('localhost') || databaseUrl?.includes('127.0.0.1') ? false : {
    rejectUnauthorized: false,
  },
  // Add connection timeout to prevent hanging
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

