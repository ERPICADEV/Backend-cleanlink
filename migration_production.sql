-- ============================================================================
-- CleanLink PostgreSQL Production Migration
-- ============================================================================
-- This migration creates all tables required for the CleanLink backend
-- Run this directly in Render PostgreSQL database to initialize production
--
-- Usage in Render:
--   1. Connect to your PostgreSQL database via psql
--   2. Run: \i migration_production.sql
--   OR copy-paste this entire file into Render's PostgreSQL query editor
-- ============================================================================

-- Drop existing tables if they exist (in reverse dependency order)
DROP TABLE IF EXISTS comment_votes CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS votes CASCADE;
DROP TABLE IF EXISTS report_progress CASCADE;
DROP TABLE IF EXISTS redemptions CASCADE;
DROP TABLE IF EXISTS rewards CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS admins CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================================
-- Core Tables
-- ============================================================================

-- Users table
CREATE TABLE users (
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reports table (civic issue reports)
CREATE TABLE reports (
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
  status TEXT DEFAULT 'pending',
  mcd_verified_by TEXT,
  mcd_resolution TEXT,
  duplicate_of TEXT,
  flags TEXT DEFAULT '[]',
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================================
-- User Interaction Tables
-- ============================================================================

-- Votes table (user votes on reports)
CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(report_id, user_id),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Comments table (comments on reports)
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  author_id TEXT,
  text TEXT NOT NULL,
  parent_comment_id TEXT,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE
);

-- Comment votes table (votes on comments)
CREATE TABLE comment_votes (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(comment_id, user_id),
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Notifications table
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================================
-- Admin & Workflow Tables
-- ============================================================================

-- Admins table (admin users with role hierarchy)
CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  region_assigned TEXT,
  role TEXT DEFAULT 'admin',
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Report Progress Tracking Table (admin workflow tracking)
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
);

-- ============================================================================
-- Rewards System Tables
-- ============================================================================

-- Rewards table (reward catalog)
CREATE TABLE rewards (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  required_points INTEGER NOT NULL,
  available_from TIMESTAMP,
  available_until TIMESTAMP,
  max_per_user INTEGER DEFAULT 1,
  metadata TEXT DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Redemptions table (user reward redemptions)
CREATE TABLE redemptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  status TEXT DEFAULT 'requested',
  request_data TEXT DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reward_id) REFERENCES rewards(id) ON DELETE CASCADE
);

-- ============================================================================
-- Audit & Logging Tables
-- ============================================================================

-- Audit logs table (system audit trail)
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Users indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_civic_points ON users(civic_points);

-- Reports indexes
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_category ON reports(category);
CREATE INDEX idx_reports_created_at ON reports(created_at);
CREATE INDEX idx_reports_reporter_id ON reports(reporter_id);
CREATE INDEX idx_reports_community_score ON reports(community_score DESC);
CREATE INDEX idx_reports_upvotes ON reports(upvotes DESC);

-- Votes indexes
CREATE INDEX idx_votes_report_user ON votes(report_id, user_id);
CREATE INDEX idx_votes_user_id ON votes(user_id);

-- Comments indexes
CREATE INDEX idx_comments_report ON comments(report_id);
CREATE INDEX idx_comments_author ON comments(author_id);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX idx_comments_created_at ON comments(created_at);

-- Comment votes indexes
CREATE INDEX idx_comment_votes_comment_user ON comment_votes(comment_id, user_id);

-- Notifications indexes
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
CREATE INDEX idx_notifications_type ON notifications(type);

-- Admins indexes
CREATE INDEX idx_admins_user_id ON admins(user_id);
CREATE INDEX idx_admins_role ON admins(role);
CREATE INDEX idx_admins_status ON admins(status);
CREATE INDEX idx_admins_region ON admins(region_assigned);

-- Report Progress indexes
CREATE INDEX idx_report_progress_report_id ON report_progress(report_id);
CREATE INDEX idx_report_progress_admin_id ON report_progress(admin_id);
CREATE INDEX idx_report_progress_status ON report_progress(progress_status);
CREATE INDEX idx_report_progress_submitted_at ON report_progress(submitted_at);

-- Rewards indexes
CREATE INDEX idx_rewards_key ON rewards(key);
CREATE INDEX idx_rewards_required_points ON rewards(required_points);
CREATE INDEX idx_rewards_available_from ON rewards(available_from);
CREATE INDEX idx_rewards_available_until ON rewards(available_until);

-- Redemptions indexes
CREATE INDEX idx_redemptions_user_id ON redemptions(user_id);
CREATE INDEX idx_redemptions_reward_id ON redemptions(reward_id);
CREATE INDEX idx_redemptions_status ON redemptions(status);
CREATE INDEX idx_redemptions_created_at ON redemptions(created_at);

-- Audit logs indexes
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- All tables and indexes have been created successfully.
-- 
-- Note: AI Queue processing is handled by Redis, not a database table.
-- The 'ai_processing_queue' is a Redis list, not a PostgreSQL table.
-- ============================================================================

