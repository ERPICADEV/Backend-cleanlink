"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRegion = exports.getRegions = exports.getMyComments = exports.getPublicProfile = exports.updateMe = exports.getMe = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const levelConfig_1 = require("../utils/levelConfig");
const mapAdminRole = (role) => {
    if (!role)
        return 'user';
    const normalized = role.toLowerCase();
    if (['super_admin', 'superadmin', 'super-admin'].includes(normalized)) {
        return 'super_admin';
    }
    if (['field_admin', 'fieldadmin', 'admin', 'normal_admin', 'normal-admin'].includes(normalized)) {
        return 'field_admin';
    }
    return 'user';
};
// GET /api/v1/users/me
const getMe = async (req, res) => {
    try {
        const userStmt = sqlite_1.default.prepare(`
      SELECT 
        u.id,
        u.username,
        u.email,
        u.region,
        u.civic_points,
        u.civic_level,
        u.badges,
        u.bio,
        u.avatar_url,
        u.trust_score,
        a.role as admin_role,
        a.region_assigned as admin_region
      FROM users u
      LEFT JOIN admins a ON a.user_id = u.id
      WHERE u.id = ?
    `);
        const user = userStmt.get(req.userId);
        if (!user) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'User not found' },
            });
        }
        // Parse JSON fields
        const clientRole = mapAdminRole(user.admin_role);
        const userData = {
            ...user,
            region: user.region ? JSON.parse(user.region) : null,
            badges: user.badges ? JSON.parse(user.badges) : [],
            civicPoints: user.civic_points,
            civicLevel: user.civic_level,
            avatarUrl: user.avatar_url,
            trustScore: user.trust_score,
            role: clientRole,
            adminRegion: user.admin_region || null,
            permissions: clientRole === 'user' ? [] : ['admin:access'],
        };
        // Calculate level progress
        const currentLevel = userData.civicLevel;
        const levelProgress = (0, levelConfig_1.calculateLevelProgress)(userData.civicPoints, currentLevel);
        const nextLevelAt = levelConfig_1.LEVEL_CONFIG[currentLevel + 1]?.minPoints || null;
        const levelName = levelConfig_1.LEVEL_CONFIG[currentLevel]?.name || 'New Citizen';
        return res.status(200).json({
            ...userData,
            level_info: {
                level: currentLevel,
                name: levelName,
                color: levelConfig_1.LEVEL_CONFIG[currentLevel]?.color || '#6B7280',
                next_level_at: nextLevelAt,
                progress: levelProgress
            }
        });
    }
    catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to get user' },
        });
    }
};
exports.getMe = getMe;
// PATCH /api/v1/users/me
const updateMe = async (req, res) => {
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
            const existingStmt = sqlite_1.default.prepare('SELECT id FROM users WHERE username = ? AND id != ?');
            const existing = existingStmt.get(username, req.userId);
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
        const updateFields = [];
        const updateParams = [];
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
            const updateStmt = sqlite_1.default.prepare(updateSql);
            updateStmt.run(...updateParams);
        }
        // Get updated user
        const userStmt = sqlite_1.default.prepare(`
      SELECT id, username, email, region, civic_points, bio, avatar_url
      FROM users WHERE id = ?
    `);
        const updated = userStmt.get(req.userId);
        // Parse region if exists
        const responseData = {
            ...updated,
            region: updated.region ? JSON.parse(updated.region) : null,
            civicPoints: updated.civic_points,
            avatarUrl: updated.avatar_url
        };
        return res.status(200).json(responseData);
    }
    catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to update user' },
        });
    }
};
exports.updateMe = updateMe;
// GET /api/v1/users/:id/public
const getPublicProfile = async (req, res) => {
    try {
        const { id } = req.params;
        const userStmt = sqlite_1.default.prepare(`
      SELECT id, username, badges, civic_points, civic_level, region
      FROM users WHERE id = ?
    `);
        const user = userStmt.get(id);
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
    }
    catch (error) {
        console.error('Get public profile error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to get profile' },
        });
    }
};
exports.getPublicProfile = getPublicProfile;
// GET /api/v1/users/me/comments
const getMyComments = async (req, res) => {
    try {
        const { limit = 20, offset = 0 } = req.query;
        const userId = req.userId;
        // Get comments by user
        const commentsStmt = sqlite_1.default.prepare(`
      SELECT c.*, u.username, u.badges, r.id as report_id, r.title as report_title
      FROM comments c 
      LEFT JOIN users u ON c.author_id = u.id 
      LEFT JOIN reports r ON c.report_id = r.id
      WHERE c.author_id = ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `);
        const comments = commentsStmt.all(userId, parseInt(limit), parseInt(offset));
        // Format comments
        const formattedComments = comments.map((comment) => ({
            id: comment.id,
            text: comment.text,
            reportId: comment.report_id,
            reportTitle: comment.report_title,
            author: {
                id: comment.author_id,
                username: comment.username || 'Anonymous',
                badges: comment.badges ? JSON.parse(comment.badges) : [],
            },
            parent_comment_id: comment.parent_comment_id,
            created_at: comment.created_at,
            updated_at: comment.updated_at,
        }));
        // Get total count
        const countStmt = sqlite_1.default.prepare('SELECT COUNT(*) as count FROM comments WHERE author_id = ?');
        const countResult = countStmt.get(userId);
        const total = countResult.count;
        return res.status(200).json({
            data: formattedComments,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
        });
    }
    catch (error) {
        console.error('Get my comments error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch comments' },
        });
    }
};
exports.getMyComments = getMyComments;
// GET /api/v1/regions
const getRegions = async (req, res) => {
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
    }
    catch (error) {
        console.error('Get regions error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to get regions' },
        });
    }
};
exports.getRegions = getRegions;
// PATCH /api/v1/users/me/region
const updateRegion = async (req, res) => {
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
        const updateStmt = sqlite_1.default.prepare('UPDATE users SET region = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        updateStmt.run(JSON.stringify(region), req.userId);
        // Get updated user
        const userStmt = sqlite_1.default.prepare('SELECT id, username, email, region FROM users WHERE id = ?');
        const updated = userStmt.get(req.userId);
        const responseData = {
            ...updated,
            region: updated.region ? JSON.parse(updated.region) : null
        };
        return res.status(200).json(responseData);
    }
    catch (error) {
        console.error('Update region error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to update region' },
        });
    }
};
exports.updateRegion = updateRegion;
