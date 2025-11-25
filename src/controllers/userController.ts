import { Request, Response } from 'express';
import prisma from '../config/database';
import { LEVEL_CONFIG, calculateLevelProgress } from '../utils/levelConfig';

// GET /api/v1/users/me
// GET /api/v1/users/me
export const getMe = async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        username: true,
        email: true,
        region: true,
        civicPoints: true,
        civicLevel: true,
        badges: true,
        bio: true,
        avatarUrl: true,
        trustScore: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    // Calculate level progress
    const currentLevel = user.civicLevel;
    const levelProgress = calculateLevelProgress(user.civicPoints, currentLevel);
    const nextLevelAt = LEVEL_CONFIG[currentLevel + 1 as keyof typeof LEVEL_CONFIG]?.minPoints || null;
    const levelName = LEVEL_CONFIG[currentLevel as keyof typeof LEVEL_CONFIG]?.name || 'New Citizen';

    return res.status(200).json({
      ...user,
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
      const existing = await prisma.user.findFirst({
        where: { username, id: { not: req.userId } },
      });
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

    const updateData: any = {};
    if (username !== undefined) updateData.username = username;
    if (bio !== undefined) updateData.bio = bio;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        region: true,
        civicPoints: true,
        bio: true,
        avatarUrl: true,
      },
    });

    return res.status(200).json(updated);
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

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        badges: true,
        civicPoints: true,
        civicLevel: true,
        region: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    // Show "Anonymous" if no username
    const publicProfile = {
      ...user,
      username: user.username || 'Anonymous',
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

    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { region },
      select: {
        id: true,
        username: true,
        email: true,
        region: true,
      },
    });

    return res.status(200).json(updated);
  } catch (error) {
    console.error('Update region error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update region' },
    });
  }
};