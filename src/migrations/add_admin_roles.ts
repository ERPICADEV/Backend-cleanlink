// 🚀 Migration Script: Run this ONCE to update existing database
// File: src/migrations/add_admin_roles.ts

import { pool } from '../config/postgres';
import { randomUUID } from 'crypto';

async function runMigration() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Step 1: Check if report_progress table exists
    const tableCheckResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'report_progress'
    `);
    const tableExists = tableCheckResult.rows.length > 0;

    if (!tableExists) {
      await client.query(`
        CREATE TABLE report_progress (
          id TEXT PRIMARY KEY,
          report_id TEXT NOT NULL,
          admin_id TEXT NOT NULL,
          progress_status TEXT DEFAULT 'not_started',
          notes TEXT,
          photos TEXT DEFAULT '[]',
          completion_details TEXT,
          submitted_at TIMESTAMP,
          approved_at TIMESTAMP,
          approved_by TEXT,
          rejection_reason TEXT,
          rejected_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
          FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
          FOREIGN KEY (approved_by) REFERENCES admins(id) ON DELETE SET NULL
        )
      `);

      await client.query(`
        CREATE INDEX idx_report_progress_report_id ON report_progress(report_id);
        CREATE INDEX idx_report_progress_admin_id ON report_progress(admin_id);
        CREATE INDEX idx_report_progress_status ON report_progress(progress_status);
      `);
    }

    // Step 2: Get current admins table structure
    const columnsResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'admins'
    `);
    const columnNames = columnsResult.rows.map((row: any) => row.column_name);
    
    const hasRoleColumn = columnNames.includes('role');
    const hasStatusColumn = columnNames.includes('status');
    const hasCreatedAt = columnNames.includes('created_at');
    const hasUpdatedAt = columnNames.includes('updated_at');

    if (!hasRoleColumn || !hasStatusColumn) {
      // Get existing data first
      const existingAdminsResult = await client.query('SELECT * FROM admins');
      const existingAdmins = existingAdminsResult.rows;
      
      // Clean up any leftover temporary table from failed migration
      await client.query(`DROP TABLE IF EXISTS admins_new CASCADE`);
      
      // Create new admins table with updated structure
      await client.query(`
        CREATE TABLE admins_new (
          id TEXT PRIMARY KEY,
          user_id TEXT UNIQUE,
          region_assigned TEXT,
          role TEXT DEFAULT 'admin',
          status TEXT DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Insert existing data with proper handling of missing columns
      for (const admin of existingAdmins) {
        const id = admin.id || randomUUID();
        const userId = admin.user_id || admin.userId;
        const regionAssigned = admin.region_assigned || null;
        const role = admin.role || 'admin';
        const status = admin.status || 'active';
        const createdAt = admin.created_at || new Date().toISOString();
        const updatedAt = admin.updated_at || new Date().toISOString();

        await client.query(`
          INSERT INTO admins_new (id, user_id, region_assigned, role, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [id, userId, regionAssigned, role, status, createdAt, updatedAt]);
      }

      // Drop old table and rename new one
      await client.query(`DROP TABLE admins CASCADE`);
      await client.query(`ALTER TABLE admins_new RENAME TO admins`);
    }

    // Step 3: Upgrade your specific admin to SuperAdmin
    const adminResult = await client.query(`
      SELECT * FROM admins WHERE user_id = $1
    `, ['60db0ccd-b7c9-4377-a386-33ace2bae63f']);
    const existingAdmin = adminResult.rows[0];

    if (existingAdmin) {
      await client.query(`
        UPDATE admins 
        SET role = 'superadmin', status = 'active', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
      `, ['60db0ccd-b7c9-4377-a386-33ace2bae63f']);
    } else {
      // Create admin record if it doesn't exist
      await client.query(`
        INSERT INTO admins (id, user_id, role, status, created_at, updated_at)
        VALUES ($1, $2, 'superadmin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [randomUUID(), '60db0ccd-b7c9-4377-a386-33ace2bae63f']);
    }

    // Step 4: Verify migration
    const verifyResult = await client.query('SELECT * FROM admins WHERE user_id = $1', 
      ['60db0ccd-b7c9-4377-a386-33ace2bae63f']);
    const admin = verifyResult.rows[0];

    // Step 5: Show status statistics
    const statsResult = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM reports WHERE status = 'assigned') as assigned_reports,
        (SELECT COUNT(*) FROM reports WHERE status = 'in_progress') as in_progress_reports,
        (SELECT COUNT(*) FROM reports WHERE status = 'pending_approval') as pending_approval_reports,
        (SELECT COUNT(*) FROM report_progress) as progress_records,
        (SELECT COUNT(*) FROM admins) as total_admins
    `);
    const stats = statsResult.rows[0];

    await client.query('COMMIT');
    console.log('✅ Migration completed successfully');
    console.log('Stats:', stats);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    console.error('Please fix the error and run again.\n');
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
runMigration().catch(console.error);