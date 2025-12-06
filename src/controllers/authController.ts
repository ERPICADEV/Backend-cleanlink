import { Request, Response } from 'express';
import { pool } from '../config/postgres';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt';
import { randomUUID } from 'crypto';
import { AdminRole, getRolePermissions } from '../lib/permissions';

// Helper to safely parse region (handles both JSON strings and plain strings)
const parseRegion = (regionStr: string | null): string | Record<string, unknown> | null => {
  if (!regionStr) return null;
  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(regionStr);
    return parsed;
  } catch {
    // If parsing fails, it's a plain string, return as-is
    return regionStr;
  }
};

// POST /api/v1/auth/signup
export const signup = async (req: Request, res: Response) => {
  try {
    const { username, email, password, phone, region, bio, avatar_url } = req.body;

    // Validations
    if (!email && !phone) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email or phone required',
          fields: { email: 'Email or phone must be provided' },
        },
      });
    }

    if (email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid email format',
          fields: { email: 'Invalid email format' },
        },
      });
    }

    if (password && (password.length < 8 || !/\d/.test(password) || !/[A-Z]/.test(password))) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Password must be at least 8 chars with 1 digit and 1 uppercase',
          fields: { password: 'Password policy not met' },
        },
      });
    }

    if (username && (username.length > 30 || !/^[a-zA-Z0-9_]+$/.test(username))) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Username must be 1-30 alphanumeric + underscore',
          fields: { username: 'Invalid username format' },
        },
      });
    }

    // Check for existing user
    if (email) {
      const result = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      const existing = result.rows[0];
      if (existing) {
        return res.status(409).json({
          error: {
            code: 'USER_EXISTS',
            message: 'Email already registered',
            fields: { email: 'This email is already in use' },
          },
        });
      }
    }

    if (phone) {
      const result = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
      const existing = result.rows[0];
      if (existing) {
        return res.status(409).json({
          error: {
            code: 'USER_EXISTS',
            message: 'Phone already registered',
            fields: { phone: 'This phone is already in use' },
          },
        });
      }
    }

    if (username) {
      const result = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
      const existing = result.rows[0];
      if (existing) {
        return res.status(409).json({
          error: {
            code: 'USER_EXISTS',
            message: 'Username already taken',
            fields: { username: 'This username is taken' },
          },
        });
      }
    }

    // Hash password if provided
    const passwordHash = password ? await hashPassword(password) : undefined;

    // Validate avatar_url if provided
    if (avatar_url && !avatar_url.match(/^(https?:\/\/|data:image\/)/)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Avatar URL must be a valid HTTP/HTTPS URL or data URL',
          fields: { avatar_url: 'Invalid avatar URL format' },
        },
      });
    }

    // Create user
    const userId = randomUUID();
    
    // Store region: if it's already a string, store as-is; if object, stringify it
    const regionToStore = region 
      ? (typeof region === 'string' ? region : JSON.stringify(region))
      : null;

    await pool.query(`
      INSERT INTO users (
        id, username, email, phone, password_hash, region, auth_providers,
        avatar_url, bio, civic_points, civic_level, trust_score, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      userId,
      username || null,
      email ? email.toLowerCase() : null,
      phone || null,
      passwordHash || null,
      regionToStore,
      password ? JSON.stringify([{ provider: 'email', provider_id: email }]) : JSON.stringify([]),
      avatar_url || null,
      bio || null,
      0, // civic_points
      1, // civic_level
      0.5, // trust_score
      'active' // status
    ]);

    // Generate tokens
    const accessToken = generateAccessToken(userId, email || undefined);
    const refreshToken = generateRefreshToken(userId);

    return res.status(201).json({
      user: {
        id: userId,
        username: username,
        email: email,
        region: region,
        bio: bio || null,
        avatarUrl: avatar_url || null,
        civicPoints: 0,
      },
      token: accessToken,
      refresh_token: refreshToken,
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Signup failed',
      },
    });
  }
};

// POST /api/v1/auth/login
const mapAdminRole = (role?: string | null) => {
  if (!role) return 'user';
  const normalized = role.toLowerCase();
  if (['super_admin', 'superadmin', 'super-admin'].includes(normalized)) {
    return 'super_admin';
  }
  if (['field_admin', 'fieldadmin', 'admin', 'normal_admin', 'normal-admin'].includes(normalized)) {
    return 'field_admin';
  }
  return 'user';
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and password required',
          fields: { email: 'Email required', password: 'Password required' },
        },
      });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user: any = result.rows[0];

    if (!user || !user.password_hash) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
    }

    const passwordValid = await verifyPassword(password, user.password_hash);

    if (!passwordValid) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
    }

    // Check if user is an admin and get admin role
    const adminResult = await pool.query('SELECT role, status, region_assigned FROM admins WHERE user_id = $1', [user.id]);
    const adminInfo: any = adminResult.rows[0];

    const accessToken = generateAccessToken(user.id, user.email || undefined);
    const refreshToken = generateRefreshToken(user.id);

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        region: parseRegion(user.region),
        civicPoints: user.civic_points,
        role: mapAdminRole(adminInfo?.role),
        adminRegion: adminInfo?.region_assigned || null,
        permissions: adminInfo?.role ? getRolePermissions(adminInfo.role as AdminRole) : [],
      },
      token: accessToken,
      refresh_token: refreshToken,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Login failed',
      },
    });
  }
};

// POST /api/v1/auth/refresh
export const refreshTokenHandler = async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Refresh token required',
        },
      });
    }

    const { verifyRefreshToken } = await import('../utils/jwt');
    const payload = verifyRefreshToken(refresh_token);

    if (!payload) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired refresh token',
        },
      });
    }

    const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [payload.sub]);
    const user: any = result.rows[0];

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not found',
        },
      });
    }

    const accessToken = generateAccessToken(user.id, user.email || undefined);

    return res.status(200).json({
      token: accessToken,
      refresh_token, // Return same refresh token
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Token refresh failed',
      },
    });
  }
};