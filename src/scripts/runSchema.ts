// Script to run database schema
// Usage: npx ts-node src/scripts/runSchema.ts

import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from '../config/postgres';

dotenv.config();

async function runSchema() {
  const client = await pool.connect();
  
  try {
    console.log('📖 Reading schema.sql...');
    const schemaPath = join(__dirname, '../../schema.sql');
    const schemaSQL = readFileSync(schemaPath, 'utf-8');
    
    console.log('🚀 Running schema...');
    
    // Execute the entire schema at once (PostgreSQL handles IF NOT EXISTS)
    // This is safer than splitting by semicolons
    try {
      await client.query(schemaSQL);
    } catch (error: any) {
      // Ignore "already exists" errors for tables/indexes
      if (error.code !== '42P07' && error.code !== '42710' && !error.message.includes('already exists')) {
        throw error;
      }
    }
    console.log('✅ Schema executed successfully!');
    
    // Verify tables were created
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\n📊 Created tables:');
    tablesResult.rows.forEach((row: any) => {
      console.log(`   - ${row.table_name}`);
    });
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Error running schema:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runSchema().catch(console.error);

