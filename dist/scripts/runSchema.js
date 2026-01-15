"use strict";
// Script to run database schema
// Usage: npx ts-node src/scripts/runSchema.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = require("fs");
const path_1 = require("path");
const postgres_1 = require("../config/postgres");
dotenv_1.default.config();
async function runSchema() {
    const client = await postgres_1.pool.connect();
    try {
        console.log('📖 Reading schema.sql...');
        const schemaPath = (0, path_1.join)(__dirname, '../../schema.sql');
        const schemaSQL = (0, fs_1.readFileSync)(schemaPath, 'utf-8');
        console.log('🚀 Running schema...');
        // Execute the entire schema at once (PostgreSQL handles IF NOT EXISTS)
        // This is safer than splitting by semicolons
        try {
            await client.query(schemaSQL);
        }
        catch (error) {
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
        tablesResult.rows.forEach((row) => {
            console.log(`   - ${row.table_name}`);
        });
    }
    catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error running schema:', error.message);
        process.exit(1);
    }
    finally {
        client.release();
        await postgres_1.pool.end();
    }
}
runSchema().catch(console.error);
