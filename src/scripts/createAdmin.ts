// src/scripts/createAdmin.ts
// Script to create admin users

import { pool } from '../config/postgres';
import { randomUUID } from 'crypto';
import { hashPassword } from '../utils/password';

interface CreateAdminParams {
  email: string;
  password: string;
  username: string;
  role: 'superadmin' | 'admin' | 'viewer';
  region?: string;
}

async function createAdmin(params: CreateAdminParams) {
  const { email, password, username, role, region } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Check if user already exists
    const userResult = await client.query('SELECT id FROM users WHERE email = $1', 
      [email.toLowerCase()]);
    let user = userResult.rows[0];

    let userId: string;

    if (user) {
      userId = user.id;
    } else {
      // 2. Create user account
      userId = randomUUID();
      const passwordHash = await hashPassword(password);

      await client.query(`
        INSERT INTO users (
          id, username, email, password_hash, region, auth_providers,
          civic_points, civic_level, trust_score, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        userId,
        username,
        email.toLowerCase(),
        passwordHash,
        region ? JSON.stringify({ city: region }) : null,
        JSON.stringify([{ provider: 'email', provider_id: email }]),
        0, // civic_points
        1, // civic_level
        0.5, // trust_score
        'active' // status
      ]);
    }

    // 3. Check if admin record exists
    const adminResult = await client.query('SELECT id, role FROM admins WHERE user_id = $1', 
      [userId]);
    const existingAdmin = adminResult.rows[0];

    if (existingAdmin) {
      // Update existing admin
      await client.query(`
        UPDATE admins 
        SET role = $1, region_assigned = $2, status = 'active', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $3
      `, [role, region || null, userId]);
    } else {
      // Create new admin record
      const adminId = randomUUID();
      await client.query(`
        INSERT INTO admins (id, user_id, region_assigned, role, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [adminId, userId, region || null, role]);
    }

    // 4. Verify creation
    const verifyResult = await client.query(`
      SELECT 
        u.id, u.email, u.username,
        a.id as admin_id, a.role, a.status
      FROM users u
      JOIN admins a ON a.user_id = u.id
      WHERE u.id = $1
    `, [userId]);
    const admin = verifyResult.rows[0];

    await client.query('COMMIT');
    return admin;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating admin:', error);
    throw error;
  } finally {
    client.release();
  }
}

// ============= USAGE EXAMPLES =============

async function main() {
  try {
    // Create super admin
    const superAdmin = await createAdmin({
      email: 'superadmin@mcd.com',
      password: 'Admin@123456',
      username: 'superadmin',
      role: 'superadmin',
    });
    console.log('✅ Super admin created:', superAdmin);

    // Create field admin
    const fieldAdmin = await createAdmin({
      email: 'fieldAdmin@mcd.com',
      password: 'Admin@123456',
      username: 'fieldAdmin',
      role: 'admin',
      region: 'Delhi'
    });
    console.log('✅ Field admin created:', fieldAdmin);
  } catch (error) {
    console.error('❌ Error in main:', error);
  } finally {
    await pool.end();
  }
}

// Run the script
main().catch(console.error);