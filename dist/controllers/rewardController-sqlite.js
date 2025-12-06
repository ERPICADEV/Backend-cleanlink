"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteReward = exports.updateReward = exports.createReward = exports.redeemReward = exports.getAllRewards = exports.getRewards = void 0;
const postgres_1 = require("../config/postgres");
const crypto_1 = require("crypto");
const notificationService_1 = require("../services/notificationService");
// GET /api/v1/rewards - Public
const getRewards = async (req, res) => {
    try {
        const now = new Date().toISOString();
        const rewardsResult = await postgres_1.pool.query(`
      SELECT * FROM rewards 
      WHERE (available_from IS NULL AND available_until IS NULL)
         OR (available_from <= $1 AND available_until >= $2)
         OR (available_from IS NULL AND available_until >= $3)
         OR (available_from <= $4 AND available_until IS NULL)
      ORDER BY required_points ASC
    `, [now, now, now, now]);
        const rewards = rewardsResult.rows;
        // Parse JSON fields
        const formattedRewards = rewards.map((reward) => ({
            ...reward,
            metadata: reward.metadata ? JSON.parse(reward.metadata) : {},
            requiredPoints: reward.required_points,
            maxPerUser: reward.max_per_user,
            availableFrom: reward.available_from,
            availableUntil: reward.available_until
        }));
        return res.status(200).json({
            data: formattedRewards,
        });
    }
    catch (error) {
        console.error('Get rewards error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch rewards' },
        });
    }
};
exports.getRewards = getRewards;
// GET /api/v1/rewards/admin/all - Admin only (all rewards including unavailable)
const getAllRewards = async (req, res) => {
    try {
        const rewardsResult = await postgres_1.pool.query(`
      SELECT * FROM rewards 
      ORDER BY created_at DESC, required_points ASC
    `);
        const rewards = rewardsResult.rows;
        // Parse JSON fields
        const formattedRewards = rewards.map((reward) => ({
            ...reward,
            metadata: reward.metadata ? JSON.parse(reward.metadata) : {},
            requiredPoints: reward.required_points,
            maxPerUser: reward.max_per_user,
            availableFrom: reward.available_from,
            availableUntil: reward.available_until
        }));
        return res.status(200).json({
            data: formattedRewards,
        });
    }
    catch (error) {
        console.error('Get all rewards error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch rewards' },
        });
    }
};
exports.getAllRewards = getAllRewards;
// POST /api/v1/rewards/:id/redeem - User
const redeemReward = async (req, res) => {
    try {
        const { id } = req.params;
        const { delivery_address, proof } = req.body;
        // Get user with current points
        const userResult = await postgres_1.pool.query('SELECT id, civic_points FROM users WHERE id = $1', [req.userId]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'User not found' },
            });
        }
        // Get user's redemption count for this reward
        const redemptionCountResult = await postgres_1.pool.query('SELECT COUNT(*) as count FROM redemptions WHERE user_id = $1 AND reward_id = $2', [req.userId, id]);
        const redemptionCount = { count: parseInt(redemptionCountResult.rows[0].count) };
        // Get reward details
        const rewardResult = await postgres_1.pool.query('SELECT * FROM rewards WHERE id = $1', [id]);
        const reward = rewardResult.rows[0];
        if (!reward) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Reward not found' },
            });
        }
        // Validations
        if (user.civic_points < reward.required_points) {
            return res.status(400).json({
                error: {
                    code: 'INSUFFICIENT_POINTS',
                    message: `Insufficient points. Required: ${reward.required_points}, Available: ${user.civic_points}`,
                },
            });
        }
        // Check max per user limit
        if (redemptionCount.count >= reward.max_per_user) {
            return res.status(400).json({
                error: {
                    code: 'REDEMPTION_LIMIT',
                    message: `Maximum redemption limit reached for this reward (${reward.max_per_user})`,
                },
            });
        }
        // Check availability
        const now = new Date();
        if (reward.available_from && now < new Date(reward.available_from)) {
            return res.status(400).json({
                error: {
                    code: 'NOT_AVAILABLE',
                    message: 'Reward is not available yet',
                },
            });
        }
        if (reward.available_until && now > new Date(reward.available_until)) {
            return res.status(400).json({
                error: {
                    code: 'EXPIRED',
                    message: 'Reward has expired',
                },
            });
        }
        // Generate redemption ID before transaction
        const redemptionId = (0, crypto_1.randomUUID)();
        const createdAt = new Date().toISOString();
        // Transaction for atomic operations
        const client = await postgres_1.pool.connect();
        try {
            await client.query('BEGIN');
            // Deduct points
            await client.query('UPDATE users SET civic_points = civic_points - $1 WHERE id = $2', [reward.required_points, req.userId]);
            // Create redemption record
            const requestData = {
                delivery_address: delivery_address || {},
                proof: proof || '',
                points_deducted: reward.required_points,
                redeemed_at: createdAt,
            };
            await client.query(`
          INSERT INTO redemptions (id, user_id, reward_id, status, request_data, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
                redemptionId,
                req.userId,
                id,
                'requested',
                JSON.stringify(requestData),
                createdAt,
                createdAt
            ]);
            // Create audit log
            const auditLogId = (0, crypto_1.randomUUID)();
            const auditDetails = {
                reward_id: id,
                reward_title: reward.title,
                points_deducted: reward.required_points,
                user_points_after: user.civic_points - reward.required_points,
                delivery_address: delivery_address,
                status: 'requested',
            };
            await client.query(`
          INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
                auditLogId,
                req.userId,
                'REWARD_REDEEMED',
                'REDEMPTION',
                redemptionId,
                JSON.stringify(auditDetails),
                createdAt
            ]);
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
        // Fire-and-forget notification to user about reward redemption
        notificationService_1.NotificationService.notifyRewardRedeemed(req.userId, id, reward.title, reward.required_points);
        return res.status(201).json({
            id: redemptionId,
            reward: {
                title: reward.title,
                description: reward.description,
                points_required: reward.required_points,
            },
            status: 'requested',
            points_deducted: reward.required_points,
            created_at: createdAt,
        });
    }
    catch (error) {
        console.error('Redeem reward error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to redeem reward' },
        });
    }
};
exports.redeemReward = redeemReward;
// POST /api/v1/admin/rewards - Admin only
const createReward = async (req, res) => {
    try {
        const { key, title, description, required_points, available_from, available_until, max_per_user = 1, metadata } = req.body;
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
        const existingResult = await postgres_1.pool.query('SELECT id FROM rewards WHERE key = $1', [key]);
        const existingReward = existingResult.rows[0];
        if (existingReward) {
            return res.status(409).json({
                error: {
                    code: 'REWARD_EXISTS',
                    message: 'Reward with this key already exists',
                },
            });
        }
        // Create reward
        const rewardId = (0, crypto_1.randomUUID)();
        await postgres_1.pool.query(`
      INSERT INTO rewards (id, key, title, description, required_points, available_from, available_until, max_per_user, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
    `, [
            rewardId,
            key,
            title,
            description,
            required_points,
            available_from ? new Date(available_from).toISOString() : null,
            available_until ? new Date(available_until).toISOString() : null,
            max_per_user,
            JSON.stringify(metadata || {})
        ]);
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        await postgres_1.pool.query(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [
            auditLogId,
            req.userId,
            'REWARD_CREATED',
            'REWARD',
            rewardId,
            JSON.stringify({
                title: title,
                required_points: required_points,
                key: key,
            })
        ]);
        // Get created reward
        const rewardResult = await postgres_1.pool.query('SELECT * FROM rewards WHERE id = $1', [rewardId]);
        const reward = rewardResult.rows[0];
        const formattedReward = {
            ...reward,
            metadata: reward.metadata ? JSON.parse(reward.metadata) : {},
            requiredPoints: reward.required_points,
            maxPerUser: reward.max_per_user,
            availableFrom: reward.available_from,
            availableUntil: reward.available_until
        };
        return res.status(201).json(formattedReward);
    }
    catch (error) {
        console.error('Create reward error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to create reward' },
        });
    }
};
exports.createReward = createReward;
// PATCH /api/v1/admin/rewards/:id - Admin only
const updateReward = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        // Get existing reward
        const existingResult = await postgres_1.pool.query('SELECT * FROM rewards WHERE id = $1', [id]);
        const existingReward = existingResult.rows[0];
        if (!existingReward) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Reward not found' },
            });
        }
        // Build update query
        const updateFields = [];
        const updateParams = [];
        let paramIndex = 1;
        Object.keys(updates).forEach(key => {
            if (key === 'required_points' || key === 'max_per_user') {
                updateFields.push(`${key} = $${paramIndex}`);
                updateParams.push(updates[key]);
                paramIndex++;
            }
            else if (key === 'available_from' || key === 'available_until') {
                updateFields.push(`${key} = $${paramIndex}`);
                updateParams.push(updates[key] ? new Date(updates[key]).toISOString() : null);
                paramIndex++;
            }
            else if (key === 'metadata') {
                updateFields.push(`${key} = $${paramIndex}`);
                updateParams.push(JSON.stringify(updates[key]));
                paramIndex++;
            }
            else {
                updateFields.push(`${key} = $${paramIndex}`);
                updateParams.push(updates[key]);
                paramIndex++;
            }
        });
        if (updateFields.length > 0) {
            const updateSql = `UPDATE rewards SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`;
            updateParams.push(id);
            await postgres_1.pool.query(updateSql, updateParams);
        }
        // Get updated reward
        const rewardResult = await postgres_1.pool.query('SELECT * FROM rewards WHERE id = $1', [id]);
        const reward = rewardResult.rows[0];
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        await postgres_1.pool.query(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [
            auditLogId,
            req.userId,
            'REWARD_UPDATED',
            'REWARD',
            id,
            JSON.stringify({
                previous: existingReward,
                updates: updates,
            })
        ]);
        const formattedReward = {
            ...reward,
            metadata: reward.metadata ? JSON.parse(reward.metadata) : {},
            requiredPoints: reward.required_points,
            maxPerUser: reward.max_per_user,
            availableFrom: reward.available_from,
            availableUntil: reward.available_until
        };
        return res.status(200).json(formattedReward);
    }
    catch (error) {
        console.error('Update reward error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to update reward' },
        });
    }
};
exports.updateReward = updateReward;
// DELETE /api/v1/admin/rewards/:id - Admin only
const deleteReward = async (req, res) => {
    try {
        const { id } = req.params;
        // Get existing reward
        const existingResult = await postgres_1.pool.query('SELECT * FROM rewards WHERE id = $1', [id]);
        const existingReward = existingResult.rows[0];
        if (!existingReward) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Reward not found' },
            });
        }
        // Delete reward
        await postgres_1.pool.query('DELETE FROM rewards WHERE id = $1', [id]);
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        await postgres_1.pool.query(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [
            auditLogId,
            req.userId,
            'REWARD_DELETED',
            'REWARD',
            id,
            JSON.stringify({
                title: existingReward.title,
                key: existingReward.key,
            })
        ]);
        return res.status(200).json({
            message: 'Reward deleted successfully',
        });
    }
    catch (error) {
        console.error('Delete reward error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to delete reward' },
        });
    }
};
exports.deleteReward = deleteReward;
