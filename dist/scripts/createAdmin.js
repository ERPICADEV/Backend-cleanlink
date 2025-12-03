"use strict";
// src/scripts/createAdmin.ts
// Script to create admin users
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const crypto_1 = require("crypto");
const password_1 = require("../utils/password");
const db = new better_sqlite3_1.default('cleanlink.db');
async function createAdmin(params) {
    const { email, password, username, role, region } = params;
    try {
        console.log(`\n🔨 Creating ${role} user...`);
        // 1. Check if user already exists
        const checkUserStmt = db.prepare('SELECT id FROM users WHERE email = ?');
        let user = checkUserStmt.get(email.toLowerCase());
        let userId;
        if (user) {
            console.log(`✅ User already exists: ${email}`);
            userId = user.id;
        }
        else {
            // 2. Create user account
            userId = (0, crypto_1.randomUUID)();
            const passwordHash = await (0, password_1.hashPassword)(password);
            const insertUserStmt = db.prepare(`
        INSERT INTO users (
          id, username, email, password_hash, region, auth_providers,
          civic_points, civic_level, trust_score, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
            insertUserStmt.run(userId, username, email.toLowerCase(), passwordHash, region ? JSON.stringify({ city: region }) : null, JSON.stringify([{ provider: 'email', provider_id: email }]), 0, // civic_points
            1, // civic_level
            0.5, // trust_score
            'active' // status
            );
            console.log(`✅ User created: ${email} (ID: ${userId})`);
        }
        // 3. Check if admin record exists
        const checkAdminStmt = db.prepare('SELECT id, role FROM admins WHERE user_id = ?');
        const existingAdmin = checkAdminStmt.get(userId);
        if (existingAdmin) {
            // Update existing admin
            const updateAdminStmt = db.prepare(`
        UPDATE admins 
        SET role = ?, region_assigned = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `);
            updateAdminStmt.run(role, region || null, userId);
            console.log(`✅ Admin role updated: ${existingAdmin.role} → ${role}`);
        }
        else {
            // Create new admin record
            const adminId = (0, crypto_1.randomUUID)();
            const insertAdminStmt = db.prepare(`
        INSERT INTO admins (id, user_id, region_assigned, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
            insertAdminStmt.run(adminId, userId, region || null, role);
            console.log(`✅ Admin record created with role: ${role}`);
        }
        // 4. Verify creation
        const verifyStmt = db.prepare(`
      SELECT 
        u.id, u.email, u.username,
        a.id as admin_id, a.role, a.status
      FROM users u
      JOIN admins a ON a.user_id = u.id
      WHERE u.id = ?
    `);
        const admin = verifyStmt.get(userId);
        console.log('\n📋 Admin Details:');
        console.log(`   Email: ${admin.email}`);
        console.log(`   Username: ${admin.username}`);
        console.log(`   User ID: ${admin.id}`);
        console.log(`   Admin ID: ${admin.admin_id}`);
        console.log(`   Role: ${admin.role}`);
        console.log(`   Status: ${admin.status}`);
        console.log('\n✅ Admin created successfully!\n');
        return admin;
    }
    catch (error) {
        console.error('❌ Error creating admin:', error);
        throw error;
    }
}
// ============= USAGE EXAMPLES =============
async function main() {
    // Create super admin
    await createAdmin({
        email: 'superadmin@mcd.com',
        password: 'Admin@123456',
        username: 'superadmin',
        role: 'superadmin',
    });
    // Example 1: Create a regular field admin
    await createAdmin({
        email: 'fieldadmin@mcd.com',
        password: 'Admin@123456',
        username: 'fieldadmin',
        role: 'admin',
        region: 'Delhi'
    });
    db.close();
}
// Run the script
main().catch(console.error);
