import Database from 'better-sqlite3'

const db = new Database('cleanlink.db')

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('synchronous = NORMAL')

// Complete SQLite schema initialization
db.exec(`
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    password_hash TEXT,
    region TEXT,
    auth_providers TEXT DEFAULT '[]',
    avatar_url TEXT,
    bio TEXT,
    civic_points INTEGER DEFAULT 0,
    civic_level INTEGER DEFAULT 1,
    badges TEXT DEFAULT '[]',
    trust_score REAL DEFAULT 0.5,
    status TEXT DEFAULT 'active',
    is_verified BOOLEAN DEFAULT false,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Reports table
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT,
    reporter_display TEXT DEFAULT 'Anonymous',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    images TEXT DEFAULT '[]',
    location TEXT DEFAULT '{}',
    visibility TEXT DEFAULT 'public',
    ai_score TEXT,
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    community_score REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',  -- 'pending' | 'assigned' | 'in_progress' | 'pending_approval' | 'resolved' | 'flagged' | 'duplicate' | 'invalid'
    mcd_verified_by TEXT,
    mcd_resolution TEXT,
    duplicate_of TEXT,
    flags TEXT DEFAULT '[]',
    is_featured BOOLEAN DEFAULT false,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL
  );

  -- Notifications table
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT DEFAULT '{}',
    is_read BOOLEAN DEFAULT false,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
  CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

  -- Votes table
  CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    value INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(report_id, user_id),
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Comments table
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    author_id TEXT,
    text TEXT NOT NULL,
    parent_comment_id TEXT,
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE
  );

  -- Comment votes table
  CREATE TABLE IF NOT EXISTS comment_votes (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    value INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(comment_id, user_id),
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Rewards table
  CREATE TABLE IF NOT EXISTS rewards (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    required_points INTEGER NOT NULL,
    available_from DATETIME,
    available_until DATETIME,
    max_per_user INTEGER DEFAULT 1,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Redemptions table
  CREATE TABLE IF NOT EXISTS redemptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    reward_id TEXT NOT NULL,
    status TEXT DEFAULT 'requested',
    request_data TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reward_id) REFERENCES rewards(id) ON DELETE CASCADE
  );

  -- Audit logs table
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    action_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ✨ UPDATED: Admins table with role hierarchy
  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE,
    region_assigned TEXT,
    role TEXT DEFAULT 'admin',  -- 'superadmin' | 'admin' | 'viewer'
    status TEXT DEFAULT 'active',  -- 'active' | 'inactive' | 'suspended'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- ✨ NEW: Report Progress Tracking Table
  CREATE TABLE IF NOT EXISTS report_progress (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    admin_id TEXT NOT NULL,
    progress_status TEXT DEFAULT 'not_started',  -- 'not_started' | 'in_progress' | 'submitted_for_approval'
    notes TEXT,
    photos TEXT DEFAULT '[]',  -- JSON array of photo URLs
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

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
  CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category);
  CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);
  CREATE INDEX IF NOT EXISTS idx_votes_report_user ON votes(report_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_comments_report ON comments(report_id);
  CREATE INDEX IF NOT EXISTS idx_comment_votes_comment_user ON comment_votes(comment_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  
  -- ✨ NEW: Report Progress Indexes
  CREATE INDEX IF NOT EXISTS idx_report_progress_report_id ON report_progress(report_id);
  CREATE INDEX IF NOT EXISTS idx_report_progress_admin_id ON report_progress(admin_id);
  CREATE INDEX IF NOT EXISTS idx_report_progress_status ON report_progress(progress_status);
`);

console.log('✅ SQLite database initialized (WAL mode enabled)')
console.log('✅ Admin roles system tables created')
console.log('✅ Report progress tracking table created')
console.log('✅ Comment voting system tables created')

// Migration: Add upvotes/downvotes columns to existing comments table if they don't exist
try {
  db.exec(`
    ALTER TABLE comments ADD COLUMN upvotes INTEGER DEFAULT 0;
    ALTER TABLE comments ADD COLUMN downvotes INTEGER DEFAULT 0;
  `);
  console.log('✅ Added upvotes/downvotes columns to comments table');
} catch (error: any) {
  // Column might already exist, which is fine
  if (!error.message.includes('duplicate column')) {
    console.log('⚠️  Could not add upvotes/downvotes columns (they may already exist)');
  }
}

// 🔧 Migration: Update existing admin to SuperAdmin role
try {
  const updateAdminStmt = db.prepare(`
    UPDATE admins 
    SET role = 'superadmin', status = 'active'
    WHERE user_id = ?
  `);
  
  const result = updateAdminStmt.run('60db0ccd-b7c9-4377-a386-33ace2bae63f');
  
  if (result.changes > 0) {
    console.log('✅ Upgraded sajidkaish9@gmail.com to SuperAdmin role');
  } else {
    console.log('⚠️  Admin record not found - you may need to create it manually');
  }
} catch (error) {
  console.log('⚠️  Could not upgrade admin role (table might be empty)');
}

export default db;