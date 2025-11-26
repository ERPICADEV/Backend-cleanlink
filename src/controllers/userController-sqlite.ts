import { Request, Response } from 'express';
import db from '../config/sqlite';
import { LEVEL_CONFIG, calculateLevelProgress } from '../utils/levelConfig';

// GET /api/v1/users/me
export const getMe = async (req: Request, res: Response) => {
  try {
    const userStmt = db.prepare(`
      SELECT id, username, email, region, civic_points, civic_level, badges, bio, avatar_url, trust_score
      FROM users WHERE id = ?
    `);
    const user: any = userStmt.get(req.userId);

    if (!user) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    // Parse JSON fields
    const userData = {
      ...user,
      region: user.region ? JSON.parse(user.region) : null,
      badges: user.badges ? JSON.parse(user.badges) : [],
      civicPoints: user.civic_points,
      civicLevel: user.civic_level,
      avatarUrl: user.avatar_url,
      trustScore: user.trust_score
    };

    // Calculate level progress
    const currentLevel = userData.civicLevel;
    const levelProgress = calculateLevelProgress(userData.civicPoints, currentLevel);
    const nextLevelAt = LEVEL_CONFIG[currentLevel + 1 as keyof typeof LEVEL_CONFIG]?.minPoints || null;
    const levelName = LEVEL_CONFIG[currentLevel as keyof typeof LEVEL_CONFIG]?.name || 'New Citizen';

    return res.status(200).json({
      ...userData,
      level_info: {
        level: currentLevel,
        name: levelName,
        color: LEVEL_CONFIG[currentLevel as keyof typeof LEVEL_CONFIG]?.color || '#6B7280',
        next_level_at: nextLevelAt,
        progress: levelProgress
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get user' },
    });
  }
};

// PATCH /api/v1/users/me
export const updateMe = async (req: Request, res: Response) => {
  try {
    const { username, bio, avatarUrl } = req.body;

    // Validate username if provided
    if (username && (username.length > 30 || !/^[a-zA-Z0-9_]+$/.test(username))) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Username must be 1-30 alphanumeric + underscore',
          fields: { username: 'Invalid format' },
        },
      });
    }

    // Check username uniqueness
    if (username) {
      const existingStmt = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?');
      const existing: any = existingStmt.get(username, req.userId);
      
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

    // Validate avatarUrl if provided
    if (avatarUrl && !avatarUrl.match(/^https?:\/\/.+/)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Avatar URL must be valid',
          fields: { avatarUrl: 'Invalid URL format' },
        },
      });
    }

    // Build update query
    const updateFields: string[] = [];
    const updateParams: any[] = [];
    
    if (username !== undefined) {
      updateFields.push('username = ?');
      updateParams.push(username);
    }
    if (bio !== undefined) {
      updateFields.push('bio = ?');
      updateParams.push(bio);
    }
    if (avatarUrl !== undefined) {
      updateFields.push('avatar_url = ?');
      updateParams.push(avatarUrl);
    }

    if (updateFields.length > 0) {
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      const updateSql = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
      updateParams.push(req.userId);
      
      const updateStmt = db.prepare(updateSql);
      updateStmt.run(...updateParams);
    }

    // Get updated user
    const userStmt = db.prepare(`
      SELECT id, username, email, region, civic_points, bio, avatar_url
      FROM users WHERE id = ?
    `);
    const updated: any = userStmt.get(req.userId);

    // Parse region if exists
    const responseData = {
      ...updated,
      region: updated.region ? JSON.parse(updated.region) : null,
      civicPoints: updated.civic_points,
      avatarUrl: updated.avatar_url
    };

    return res.status(200).json(responseData);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update user' },
    });
  }
};

// GET /api/v1/users/:id/public
export const getPublicProfile = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const userStmt = db.prepare(`
      SELECT id, username, badges, civic_points, civic_level, region
      FROM users WHERE id = ?
    `);
    const user: any = userStmt.get(id);

    if (!user) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    // Parse JSON fields
    const publicProfile = {
      id: user.id,
      username: user.username || 'Anonymous',
      badges: user.badges ? JSON.parse(user.badges) : [],
      civicPoints: user.civic_points,
      civicLevel: user.civic_level,
      region: user.region ? JSON.parse(user.region) : null,
    };

    return res.status(200).json(publicProfile);
  } catch (error) {
    console.error('Get public profile error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get profile' },
    });
  }
};

// GET /api/v1/regions
export const getRegions = async (req: Request, res: Response) => {
  try {
    // Hardcoded for now; can be DB-driven later
    const regions = {
      countries: [
        {
          name: 'India',
          states: [
            {
              name: 'Delhi',
              cities: ['New Delhi', 'South Delhi', 'North Delhi', 'East Delhi', 'West Delhi'],
            },
          ],
        },
      ],
    };

    return res.status(200).json(regions);
  } catch (error) {
    console.error('Get regions error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get regions' },
    });
  }
};

// PATCH /api/v1/users/me/region
export const updateRegion = async (req: Request, res: Response) => {
  try {
    const { region } = req.body;

    if (!region || !region.country || !region.state || !region.city) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Region must include country, state, city',
          fields: { region: 'Invalid region object' },
        },
      });
    }

    const updateStmt = db.prepare('UPDATE users SET region = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    updateStmt.run(JSON.stringify(region), req.userId);

    // Get updated user
    const userStmt = db.prepare('SELECT id, username, email, region FROM users WHERE id = ?');
    const updated: any = userStmt.get(req.userId);

    const responseData = {
      ...updated,
      region: updated.region ? JSON.parse(updated.region) : null
    };

    return res.status(200).json(responseData);
  } catch (error) {
    console.error('Update region error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update region' },
    });
  }
};