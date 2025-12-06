-- ============================================================================
-- Insert Superadmin and Field Admin Users
-- ============================================================================
-- Simple INSERT queries for existing tables
-- Password for both: Admin@123456
-- ============================================================================

-- Step 1: Insert Superadmin User
INSERT INTO users (
  id, 
  username, 
  email, 
  password_hash, 
  region, 
  auth_providers,
  civic_points, 
  civic_level, 
  trust_score, 
  status, 
  created_at, 
  updated_at
) VALUES (
  gen_random_uuid()::text,
  'superadmin',
  'superadmin@mcd.com',
  '$2b$10$WqovWzB/qw6GPOTqtDFNyeoNnVKR5hcfL84VifmzdpHZF2OHtvS9C',
  NULL,
  '[{"provider":"email","provider_id":"superadmin@mcd.com"}]',
  0,
  1,
  0.5,
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Step 2: Insert Superadmin Admin Record
-- (Replace 'USER_ID_FROM_ABOVE' with the actual user_id from Step 1, or use this query)
INSERT INTO admins (
  id,
  user_id,
  region_assigned,
  role,
  status,
  created_at,
  updated_at
)
SELECT 
  gen_random_uuid()::text,
  id,
  NULL,
  'superadmin',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM users
WHERE email = 'superadmin@mcd.com';

-- Step 3: Insert Field Admin User
INSERT INTO users (
  id, 
  username, 
  email, 
  password_hash, 
  region, 
  auth_providers,
  civic_points, 
  civic_level, 
  trust_score, 
  status, 
  created_at, 
  updated_at
) VALUES (
  gen_random_uuid()::text,
  'fieldadmin',
  'fieldadmin@mcd.com',
  '$2b$10$WqovWzB/qw6GPOTqtDFNyeoNnVKR5hcfL84VifmzdpHZF2OHtvS9C',
  '{"city":"Delhi"}',
  '[{"provider":"email","provider_id":"fieldadmin@mcd.com"}]',
  0,
  1,
  0.5,
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Step 4: Insert Field Admin Admin Record
INSERT INTO admins (
  id,
  user_id,
  region_assigned,
  role,
  status,
  created_at,
  updated_at
)
SELECT 
  gen_random_uuid()::text,
  id,
  'Delhi',
  'admin',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM users
WHERE email = 'fieldadmin@mcd.com';

-- ============================================================================
-- Verify the inserts
-- ============================================================================
SELECT 
  u.email,
  u.username,
  a.role,
  a.region_assigned,
  a.status
FROM users u
JOIN admins a ON a.user_id = u.id
WHERE u.email IN ('superadmin@mcd.com', 'fieldadmin@mcd.com');

