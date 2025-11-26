"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteReward = exports.updateReward = exports.createReward = exports.redeemReward = exports.getRewards = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const crypto_1 = require("crypto");
// GET /api/v1/rewards - Public
const getRewards = async (req, res) => {
    try {
        const now = new Date().toISOString();
        const rewardsStmt = sqlite_1.default.prepare(`
      SELECT * FROM rewards 
      WHERE (available_from IS NULL AND available_until IS NULL)
         OR (available_from <= ? AND available_until >= ?)
         OR (available_from IS NULL AND available_until >= ?)
         OR (available_from <= ? AND available_until IS NULL)
      ORDER BY required_points ASC
    `);
        const rewards = rewardsStmt.all(now, now, now, now);
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
// POST /api/v1/rewards/:id/redeem - User
const redeemReward = async (req, res) => {
    try {
        const { id } = req.params;
        const { delivery_address, proof } = req.body;
        // Get user with current points
        const userStmt = sqlite_1.default.prepare('SELECT id, civic_points FROM users WHERE id = ?');
        const user = userStmt.get(req.userId);
        if (!user) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'User not found' },
            });
        }
        // Get user's redemption count for this reward
        const redemptionCountStmt = sqlite_1.default.prepare('SELECT COUNT(*) as count FROM redemptions WHERE user_id = ? AND reward_id = ?');
        const redemptionCount = redemptionCountStmt.get(req.userId, id);
        // Get reward details
        const rewardStmt = sqlite_1.default.prepare('SELECT * FROM rewards WHERE id = ?');
        const reward = rewardStmt.get(id);
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
        sqlite_1.default.transaction(() => {
            // Deduct points
            const updateUserStmt = sqlite_1.default.prepare('UPDATE users SET civic_points = civic_points - ? WHERE id = ?');
            updateUserStmt.run(reward.required_points, req.userId);
            // Create redemption record
            const requestData = {
                delivery_address: delivery_address || {},
                proof: proof || '',
                points_deducted: reward.required_points,
                redeemed_at: createdAt,
            };
            const insertRedemptionStmt = sqlite_1.default.prepare(`
          INSERT INTO redemptions (id, user_id, reward_id, status, request_data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
            insertRedemptionStmt.run(redemptionId, req.userId, id, 'requested', JSON.stringify(requestData), createdAt, createdAt);
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
            const insertAuditStmt = sqlite_1.default.prepare(`
          INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
            insertAuditStmt.run(auditLogId, req.userId, 'REWARD_REDEEMED', 'REDEMPTION', redemptionId, JSON.stringify(auditDetails), createdAt);
        })();
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
        const existingStmt = sqlite_1.default.prepare('SELECT id FROM rewards WHERE key = ?');
        const existingReward = existingStmt.get(key);
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
        const insertStmt = sqlite_1.default.prepare(`
      INSERT INTO rewards (id, key, title, description, required_points, available_from, available_until, max_per_user, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
        insertStmt.run(rewardId, key, title, description, required_points, available_from ? new Date(available_from).toISOString() : null, available_until ? new Date(available_until).toISOString() : null, max_per_user, JSON.stringify(metadata || {}));
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        const auditStmt = sqlite_1.default.prepare(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
        auditStmt.run(auditLogId, req.userId, 'REWARD_CREATED', 'REWARD', rewardId, JSON.stringify({
            title: title,
            required_points: required_points,
            key: key,
        }));
        // Get created reward
        const rewardStmt = sqlite_1.default.prepare('SELECT * FROM rewards WHERE id = ?');
        const reward = rewardStmt.get(rewardId);
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
        const existingStmt = sqlite_1.default.prepare('SELECT * FROM rewards WHERE id = ?');
        const existingReward = existingStmt.get(id);
        if (!existingReward) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Reward not found' },
            });
        }
        // Build update query
        const updateFields = [];
        const updateParams = [];
        Object.keys(updates).forEach(key => {
            if (key === 'required_points' || key === 'max_per_user') {
                updateFields.push(`${key} = ?`);
                updateParams.push(updates[key]);
            }
            else if (key === 'available_from' || key === 'available_until') {
                updateFields.push(`${key} = ?`);
                updateParams.push(updates[key] ? new Date(updates[key]).toISOString() : null);
            }
            else if (key === 'metadata') {
                updateFields.push(`${key} = ?`);
                updateParams.push(JSON.stringify(updates[key]));
            }
            else {
                updateFields.push(`${key} = ?`);
                updateParams.push(updates[key]);
            }
        });
        if (updateFields.length > 0) {
            const updateSql = `UPDATE rewards SET ${updateFields.join(', ')} WHERE id = ?`;
            updateParams.push(id);
            const updateStmt = sqlite_1.default.prepare(updateSql);
            updateStmt.run(...updateParams);
        }
        // Get updated reward
        const rewardStmt = sqlite_1.default.prepare('SELECT * FROM rewards WHERE id = ?');
        const reward = rewardStmt.get(id);
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        const auditStmt = sqlite_1.default.prepare(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
        auditStmt.run(auditLogId, req.userId, 'REWARD_UPDATED', 'REWARD', id, JSON.stringify({
            previous: existingReward,
            updates: updates,
        }));
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
        const existingStmt = sqlite_1.default.prepare('SELECT * FROM rewards WHERE id = ?');
        const existingReward = existingStmt.get(id);
        if (!existingReward) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Reward not found' },
            });
        }
        // Delete reward
        const deleteStmt = sqlite_1.default.prepare('DELETE FROM rewards WHERE id = ?');
        deleteStmt.run(id);
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        const auditStmt = sqlite_1.default.prepare(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
        auditStmt.run(auditLogId, req.userId, 'REWARD_DELETED', 'REWARD', id, JSON.stringify({
            title: existingReward.title,
            key: existingReward.key,
        }));
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
