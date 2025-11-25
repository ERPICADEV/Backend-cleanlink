import { Request, Response } from 'express';
import prisma from '../config/database';

// GET /api/v1/rewards - Public
export const getRewards = async (req: Request, res: Response) => {
  try {
    const rewards = await prisma.reward.findMany({
      where: {
        OR: [
          {
            availableFrom: null,
            availableUntil: null,
          },
          {
            availableFrom: { lte: new Date() },
            availableUntil: { gte: new Date() },
          },
        ],
      },
      orderBy: {
        requiredPoints: 'asc',
      },
    });

    return res.status(200).json({
      data: rewards,
    });
  } catch (error) {
    console.error('Get rewards error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch rewards' },
    });
  }
};

// POST /api/v1/rewards/:id/redeem - User
export const redeemReward = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { delivery_address, proof } = req.body;

    // Get user with current points and redemption history
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        id: true,
        civicPoints: true,
        redemptions: {
          where: {
            rewardId: id,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
    }

    // Get reward details
    const reward = await prisma.reward.findUnique({
      where: { id },
    });

    if (!reward) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Reward not found' },
      });
    }

    // Validations
    if (user.civicPoints < reward.requiredPoints) {
      return res.status(400).json({
        error: {
          code: 'INSUFFICIENT_POINTS',
          message: `Insufficient points. Required: ${reward.requiredPoints}, Available: ${user.civicPoints}`,
        },
      });
    }

    // Check max per user limit
    const userRedemptionsCount = user.redemptions.length;
    if (userRedemptionsCount >= reward.maxPerUser) {
      return res.status(400).json({
        error: {
          code: 'REDEMPTION_LIMIT',
          message: `Maximum redemption limit reached for this reward (${reward.maxPerUser})`,
        },
      });
    }

    // Check availability
    const now = new Date();
    if (reward.availableFrom && now < reward.availableFrom) {
      return res.status(400).json({
        error: {
          code: 'NOT_AVAILABLE',
          message: 'Reward is not available yet',
        },
      });
    }

    if (reward.availableUntil && now > reward.availableUntil) {
      return res.status(400).json({
        error: {
          code: 'EXPIRED',
          message: 'Reward has expired',
        },
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Deduct points
      await tx.user.update({
        where: { id: req.userId! },
        data: {
          civicPoints: {
            decrement: reward.requiredPoints,
          },
        },
      });

      // Create redemption record
      const redemption = await tx.redemption.create({
        data: {
          userId: req.userId!,
          rewardId: id,
          status: 'requested',
          requestData: {
            delivery_address: delivery_address || {},
            proof: proof || '',
            points_deducted: reward.requiredPoints,
            redeemed_at: new Date().toISOString(),
          },
        },
        include: {
          reward: {
            select: {
              title: true,
              description: true,
              requiredPoints: true,
            },
          },
        },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          actorId: req.userId!,
          actionType: 'REWARD_REDEEMED',
          targetType: 'REDEMPTION',
          targetId: redemption.id,
          details: {
            reward_id: id,
            reward_title: reward.title,
            points_deducted: reward.requiredPoints,
            user_points_after: user.civicPoints - reward.requiredPoints,
            delivery_address: delivery_address,
            status: 'requested',
          },
        },
      });

      return redemption;
    });

    return res.status(201).json({
      id: result.id,
      reward: {
        title: result.reward.title,
        description: result.reward.description,
        points_required: result.reward.requiredPoints,
      },
      status: result.status,
      points_deducted: reward.requiredPoints,
      created_at: result.createdAt,
    });
  } catch (error) {
    console.error('Redeem reward error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to redeem reward' },
    });
  }
};

// POST /api/v1/admin/rewards - Admin only
export const createReward = async (req: Request, res: Response) => {
  try {
    const {
      key,
      title,
      description,
      required_points,
      available_from,
      available_until,
      max_per_user = 1,
      metadata
    } = req.body;

    // Validations
    if (!key || !title || !description || !required_points) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Key, title, description, and required_points are required',
        },
      });
    }

    // Check if key already exists
    const existingReward = await prisma.reward.findUnique({
      where: { key },
    });

    if (existingReward) {
      return res.status(409).json({
        error: {
          code: 'REWARD_EXISTS',
          message: 'Reward with this key already exists',
        },
      });
    }

    const reward = await prisma.reward.create({
      data: {
        key,
        title,
        description,
        requiredPoints: required_points,
        availableFrom: available_from ? new Date(available_from) : null,
        availableUntil: available_until ? new Date(available_until) : null,
        maxPerUser: max_per_user,
        metadata: metadata || {},
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        actorId: req.userId!,
        actionType: 'REWARD_CREATED',
        targetType: 'REWARD',
        targetId: reward.id,
        details: {
          title: reward.title,
          required_points: reward.requiredPoints,
          key: reward.key,
        },
      },
    });

    return res.status(201).json(reward);
  } catch (error) {
    console.error('Create reward error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create reward' },
    });
  }
};

// PATCH /api/v1/admin/rewards/:id - Admin only
export const updateReward = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const existingReward = await prisma.reward.findUnique({
      where: { id },
    });

    if (!existingReward) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Reward not found' },
      });
    }

    const reward = await prisma.reward.update({
      where: { id },
      data: updates,
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        actorId: req.userId!,
        actionType: 'REWARD_UPDATED',
        targetType: 'REWARD',
        targetId: reward.id,
        details: {
          previous: existingReward,
          updates: updates,
        },
      },
    });

    return res.status(200).json(reward);
  } catch (error) {
    console.error('Update reward error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update reward' },
    });
  }
};

// DELETE /api/v1/admin/rewards/:id - Admin only
export const deleteReward = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const existingReward = await prisma.reward.findUnique({
      where: { id },
    });

    if (!existingReward) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Reward not found' },
      });
    }

    await prisma.reward.delete({
      where: { id },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        actorId: req.userId!,
        actionType: 'REWARD_DELETED',
        targetType: 'REWARD',
        targetId: id,
        details: {
          title: existingReward.title,
          key: existingReward.key,
        },
      },
    });

    return res.status(200).json({
      message: 'Reward deleted successfully',
    });
  } catch (error) {
    console.error('Delete reward error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete reward' },
    });
  }
};