"use strict";
// 🚀 Migration Script: Run this ONCE to update existing database
// File: src/migrations/add_admin_roles.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const crypto_1 = require("crypto");
const db = new better_sqlite3_1.default('cleanlink.db');
console.log('🔄 Starting database migration for admin roles system...\n');
try {
    // Step 1: Check if report_progress table exists
    const checkTableStmt = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='report_progress'
  `);
    const tableExists = checkTableStmt.get();
    if (!tableExists) {
        console.log('📊 Creating report_progress table...');
        db.exec(`
      CREATE TABLE report_progress (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        admin_id TEXT NOT NULL,
        progress_status TEXT DEFAULT 'not_started',
        notes TEXT,
        photos TEXT DEFAULT '[]',
        completion_details TEXT,
        submitted_at DATETIME,
        approved_at DATETIME,
        approved_by TEXT,
        rejection_reason TEXT,
        rejected_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
        FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
        FOREIGN KEY (approved_by) REFERENCES admins(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_report_progress_report_id ON report_progress(report_id);
      CREATE INDEX idx_report_progress_admin_id ON report_progress(admin_id);
      CREATE INDEX idx_report_progress_status ON report_progress(progress_status);
    `);
        console.log('✅ report_progress table created\n');
    }
    else {
        console.log('✅ report_progress table already exists\n');
    }
    // Step 2: Get current admins table structure
    console.log('🔍 Checking admins table structure...');
    const checkColumnStmt = db.prepare(`PRAGMA table_info(admins)`);
    const columns = checkColumnStmt.all();
    console.log('Current columns:', columns.map((c) => c.name).join(', '));
    const hasRoleColumn = columns.some((col) => col.name === 'role');
    const hasStatusColumn = columns.some((col) => col.name === 'status');
    const hasCreatedAt = columns.some((col) => col.name === 'created_at');
    const hasUpdatedAt = columns.some((col) => col.name === 'updated_at');
    if (!hasRoleColumn || !hasStatusColumn) {
        console.log('🔧 Updating admins table structure...');
        // Get existing data first
        const existingAdmins = db.prepare('SELECT * FROM admins').all();
        console.log(`Found ${existingAdmins.length} existing admin(s)`);
        // Clean up any leftover temporary table from failed migration
        try {
            db.exec(`DROP TABLE IF EXISTS admins_new;`);
            console.log('🧹 Cleaned up temporary table');
        }
        catch (e) {
            // Ignore if table doesn't exist
        }
        // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
        db.exec(`
      -- Create new admins table with updated structure
      CREATE TABLE admins_new (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE,
        region_assigned TEXT,
        role TEXT DEFAULT 'admin',
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
        // Insert existing data with proper handling of missing columns
        const insertStmt = db.prepare(`
      INSERT INTO admins_new (id, user_id, region_assigned, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        for (const admin of existingAdmins) {
            const id = admin.id || (0, crypto_1.randomUUID)();
            const userId = admin.user_id || admin.userId;
            const regionAssigned = admin.region_assigned || null;
            const role = admin.role || 'admin';
            const status = admin.status || 'active';
            const createdAt = admin.created_at || new Date().toISOString();
            const updatedAt = admin.updated_at || new Date().toISOString();
            insertStmt.run(id, userId, regionAssigned, role, status, createdAt, updatedAt);
        }
        // Drop old table and rename new one
        db.exec(`
      DROP TABLE admins;
      ALTER TABLE admins_new RENAME TO admins;
    `);
        console.log('✅ admins table updated with role and status columns\n');
    }
    else {
        console.log('✅ admins table already has role and status columns\n');
    }
    // Step 3: Upgrade your specific admin to SuperAdmin
    console.log('👑 Setting up SuperAdmin...');
    const adminStmt = db.prepare(`
    SELECT * FROM admins WHERE user_id = ?
  `);
    const existingAdmin = adminStmt.get('60db0ccd-b7c9-4377-a386-33ace2bae63f');
    if (existingAdmin) {
        const updateStmt = db.prepare(`
      UPDATE admins 
      SET role = 'superadmin', status = 'active', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `);
        updateStmt.run('60db0ccd-b7c9-4377-a386-33ace2bae63f');
        console.log('✅ sajidkaish9@gmail.com upgraded to SuperAdmin\n');
    }
    else {
        // Create admin record if it doesn't exist
        const insertStmt = db.prepare(`
      INSERT INTO admins (id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, 'superadmin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
        insertStmt.run((0, crypto_1.randomUUID)(), '60db0ccd-b7c9-4377-a386-33ace2bae63f');
        console.log('✅ Created SuperAdmin for sajidkaish9@gmail.com\n');
    }
    // Step 4: Verify migration
    console.log('🔍 Verifying migration...');
    const verifyAdmin = db.prepare('SELECT * FROM admins WHERE user_id = ?');
    const admin = verifyAdmin.get('60db0ccd-b7c9-4377-a386-33ace2bae63f');
    if (admin && admin.role === 'superadmin') {
        console.log('✅ Verification successful!');
        console.log(`   Admin ID: ${admin.id}`);
        console.log(`   User ID: ${admin.user_id}`);
        console.log(`   Role: ${admin.role}`);
        console.log(`   Status: ${admin.status}\n`);
    }
    else {
        console.log('⚠️  Admin found but role not set correctly:', admin);
    }
    // Step 5: Show status statistics
    const statsStmt = db.prepare(`
    SELECT 
      (SELECT COUNT(*) FROM reports WHERE status = 'assigned') as assigned_reports,
      (SELECT COUNT(*) FROM reports WHERE status = 'in_progress') as in_progress_reports,
      (SELECT COUNT(*) FROM reports WHERE status = 'pending_approval') as pending_approval_reports,
      (SELECT COUNT(*) FROM report_progress) as progress_records,
      (SELECT COUNT(*) FROM admins) as total_admins
  `);
    const stats = statsStmt.get();
    console.log('📊 Database Statistics:');
    console.log(`   Total Admins: ${stats.total_admins}`);
    console.log(`   Progress Records: ${stats.progress_records}`);
    console.log(`   Assigned Reports: ${stats.assigned_reports}`);
    console.log(`   In Progress: ${stats.in_progress_reports}`);
    console.log(`   Pending Approval: ${stats.pending_approval_reports}\n`);
    console.log('✅ Migration completed successfully!\n');
    console.log('🚀 Next steps:');
    console.log('   1. Replace your src/config/sqlite.ts with the new version');
    console.log('   2. Restart your server');
    console.log('   3. Test login with sajidkaish9@gmail.com\n');
}
catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Please fix the error and run again.\n');
    process.exit(1);
}
db.close();
