"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReportAuditLogs = exports.resolveReport = exports.assignReport = exports.getAdminReports = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const crypto_1 = require("crypto");
const levelConfig_1 = require("../utils/levelConfig");
const notificationService_1 = require("../services/notificationService");
// GET /api/v1/admin/reports
const getAdminReports = async (req, res) => {
    try {
        const { region, category, status, sort = 'new', limit = 20 } = req.query;
        let whereClause = 'WHERE 1=1';
        const params = [];
        const adminRegion = req.adminRegion;
        // Filter by admin's assigned region if specified
        if (adminRegion && adminRegion.city) {
            // Simplified region filtering
            whereClause += ' AND reporter_id IN (SELECT id FROM users WHERE region LIKE ?)';
            params.push(`%${adminRegion.city}%`);
        }
        if (category) {
            whereClause += ' AND category = ?';
            params.push(category);
        }
        if (status) {
            whereClause += ' AND status = ?';
            params.push(status);
        }
        let orderBy = 'ORDER BY created_at DESC';
        switch (sort) {
            case 'hot':
                orderBy = 'ORDER BY community_score DESC';
                break;
            case 'top':
                orderBy = 'ORDER BY upvotes DESC';
                break;
            case 'priority':
                orderBy = 'ORDER BY created_at ASC'; // Oldest first for priority
                break;
        }
        const sql = `
      SELECT 
        r.*,
        u.username, u.email, u.phone, u.region as user_region,
        (SELECT COUNT(*) FROM comments c WHERE c.report_id = r.id) as comments_count,
        (SELECT COUNT(*) FROM votes v WHERE v.report_id = r.id) as votes_count
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      ${whereClause}
      ${orderBy}
      LIMIT ?
    `;
        params.push(parseInt(limit));
        const stmt = sqlite_1.default.prepare(sql);
        const reports = stmt.all(...params);
        const formattedReports = reports.map(report => ({
            id: report.id,
            title: report.title,
            description: report.description,
            category: report.category,
            status: report.status,
            upvotes: report.upvotes,
            downvotes: report.downvotes,
            community_score: report.community_score,
            created_at: report.created_at,
            reporter: report.reporter_id ? {
                id: report.reporter_id,
                username: report.username,
                email: report.email,
                phone: report.phone,
                region: report.user_region ? JSON.parse(report.user_region) : null,
            } : null,
            comments_count: report.comments_count,
            votes_count: report.votes_count,
        }));
        return res.status(200).json({
            data: formattedReports,
            paging: null // Simplified pagination
        });
    }
    catch (error) {
        console.error('Get admin reports error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch admin reports' },
        });
    }
};
exports.getAdminReports = getAdminReports;
// PATCH /api/v1/admin/reports/:id/assign
const assignReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { assigned_to, notes } = req.body;
        if (!assigned_to) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'assigned_to field is required',
                    fields: { assigned_to: 'Must specify who to assign this report to' },
                },
            });
        }
        // Check if report exists
        const reportStmt = sqlite_1.default.prepare('SELECT * FROM reports WHERE id = ?');
        const report = reportStmt.get(id);
        if (!report) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        // Update report
        const updateStmt = sqlite_1.default.prepare(`
      UPDATE reports 
      SET status = 'assigned', mcd_verified_by = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
        updateStmt.run(req.userId, id);
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        const auditStmt = sqlite_1.default.prepare(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
        auditStmt.run(auditLogId, req.userId, 'REPORT_ASSIGNED', 'REPORT', id, JSON.stringify({
            assigned_to,
            notes: notes || '',
            previous_status: report.status,
            new_status: 'assigned',
            assigned_by: req.userId,
        }));
        return res.status(200).json({
            id: id,
            status: 'assigned',
            assigned_to,
            assigned_by: req.userId,
            assigned_at: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error('Assign report error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to assign report' },
        });
    }
};
exports.assignReport = assignReport;
// PATCH /api/v1/admin/reports/:id/resolve
const resolveReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { cleaned_image_url, notes } = req.body;
        if (!cleaned_image_url) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'cleaned_image_url is required for resolution',
                    fields: { cleaned_image_url: 'Must provide after-clean image' },
                },
            });
        }
        // Get report with reporter info
        const reportStmt = sqlite_1.default.prepare(`
      SELECT 
        r.*,
        u.civic_points, u.civic_level
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      WHERE r.id = ?
    `);
        const report = reportStmt.get(id);
        if (!report) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        // Get comments count
        const commentsStmt = sqlite_1.default.prepare('SELECT COUNT(*) as count FROM comments WHERE report_id = ?');
        const commentsCount = commentsStmt.get(id);
        let totalPoints = 0;
        let pointsBreakdown = {};
        // Transaction for atomic operations
        sqlite_1.default.transaction(() => {
            // 1. Update report as resolved
            const mcdResolution = {
                cleaned_image_url,
                notes: notes || '',
                resolved_at: new Date().toISOString(),
                resolved_by: req.userId,
            };
            const updateReportStmt = sqlite_1.default.prepare(`
        UPDATE reports 
        SET status = 'resolved', mcd_verified_by = ?, mcd_resolution = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
            updateReportStmt.run(req.userId, JSON.stringify(mcdResolution), id);
            // 2. Award civic points (only if non-anonymous reporter)
            if (report.reporter_id) {
                const basePoints = 30;
                // AI Confidence Bonus (0–20)
                const aiScore = report.ai_score ? JSON.parse(report.ai_score) : {};
                const aiConfidence = aiScore?.legit || 0.5;
                const aiBonus = Math.floor(aiConfidence * 20);
                // Severity Bonus (0–15)
                const severity = aiScore?.severity || 0.5;
                const severityBonus = Math.floor(severity * 15);
                // Engagement Bonus (0–25)
                const engagementScore = Math.min((report.upvotes * 2) + (commentsCount.count || 0), 25);
                // Resolution Bonus (fixed)
                const resolutionBonus = 30;
                totalPoints =
                    basePoints +
                        aiBonus +
                        severityBonus +
                        engagementScore +
                        resolutionBonus;
                pointsBreakdown = {
                    base: basePoints,
                    ai_bonus: aiBonus,
                    severity_bonus: severityBonus,
                    engagement: engagementScore,
                    resolution: resolutionBonus,
                    total: totalPoints,
                };
                // Add points to user
                const updateUserStmt = sqlite_1.default.prepare('UPDATE users SET civic_points = civic_points + ? WHERE id = ?');
                updateUserStmt.run(totalPoints, report.reporter_id);
                // 3. Level update
                const newTotalPoints = (report.civic_points || 0) + totalPoints;
                const previousLevel = report.civic_level || 1;
                const newLevel = (0, levelConfig_1.calculateLevel)(newTotalPoints);
                if (newLevel !== previousLevel) {
                    const updateLevelStmt = sqlite_1.default.prepare('UPDATE users SET civic_level = ? WHERE id = ?');
                    updateLevelStmt.run(newLevel, report.reporter_id);
                    console.log(`🎉 User ${report.reporter_id} leveled up: ${previousLevel} → ${newLevel}`);
                    // Audit log for level up
                    const levelAuditId = (0, crypto_1.randomUUID)();
                    const levelAuditStmt = sqlite_1.default.prepare(`
            INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `);
                    levelAuditStmt.run(levelAuditId, req.userId, 'USER_LEVEL_UP', 'USER', report.reporter_id, JSON.stringify({
                        old_level: previousLevel,
                        new_level: newLevel,
                        points: newTotalPoints,
                    }));
                    // Notify about level up
                    if (newLevel > previousLevel) {
                        const levelName = levelConfig_1.LEVEL_CONFIG[newLevel]?.name || 'New Level';
                        notificationService_1.NotificationService.notifyLevelUp(report.reporter_id, newLevel, levelName);
                    }
                }
                // Notify about report resolution and points
                notificationService_1.NotificationService.notifyReportResolved(report.reporter_id, id, totalPoints, newLevel);
                // Audit log for points awarded
                const pointsAuditId = (0, crypto_1.randomUUID)();
                const pointsAuditStmt = sqlite_1.default.prepare(`
          INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
                pointsAuditStmt.run(pointsAuditId, req.userId, 'POINTS_AWARDED', 'USER', report.reporter_id, JSON.stringify({
                    points_awarded: totalPoints,
                    reason: 'report_resolved',
                    report_id: id,
                    total_points: newTotalPoints,
                    points_breakdown: pointsBreakdown,
                }));
            }
            // 4. Audit log for resolution
            const resolutionAuditId = (0, crypto_1.randomUUID)();
            const resolutionAuditStmt = sqlite_1.default.prepare(`
        INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
            resolutionAuditStmt.run(resolutionAuditId, req.userId, 'REPORT_RESOLVED', 'REPORT', id, JSON.stringify({
                cleaned_image_url,
                notes: notes || '',
                previous_status: report.status,
                new_status: 'resolved',
                resolved_by: req.userId,
                points_awarded: report.reporter_id ? totalPoints : 0,
            }));
        })();
        return res.status(200).json({
            id,
            status: 'resolved',
            resolved_by: req.userId,
            resolved_at: new Date().toISOString(),
            points_awarded: report.reporter_id ? totalPoints : 0,
            points_breakdown: report.reporter_id ? pointsBreakdown : null,
        });
    }
    catch (error) {
        console.error('Resolve report error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve report' },
        });
    }
};
exports.resolveReport = resolveReport;
// GET /api/v1/admin/audit/reports/:id
const getReportAuditLogs = async (req, res) => {
    try {
        const { id } = req.params;
        const { limit = 50 } = req.query;
        // Check if report exists
        const reportStmt = sqlite_1.default.prepare('SELECT id FROM reports WHERE id = ?');
        const report = reportStmt.get(id);
        if (!report) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        const auditStmt = sqlite_1.default.prepare(`
      SELECT 
        al.*,
        u.username, u.email
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_id = u.id
      WHERE al.target_type = 'REPORT' AND al.target_id = ?
      ORDER BY al.created_at DESC
      LIMIT ?
    `);
        const auditLogs = auditStmt.all(id, parseInt(limit));
        const formattedAuditLogs = auditLogs.map(log => ({
            id: log.id,
            actor_id: log.actor_id,
            action_type: log.action_type,
            target_type: log.target_type,
            target_id: log.target_id,
            details: log.details ? JSON.parse(log.details) : {},
            created_at: log.created_at,
            actor: log.actor_id ? {
                id: log.actor_id,
                username: log.username,
                email: log.email,
            } : null,
        }));
        return res.status(200).json({
            data: formattedAuditLogs,
            paging: null, // Simplified pagination
        });
    }
    catch (error) {
        console.error('Get audit logs error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit logs' },
        });
    }
};
exports.getReportAuditLogs = getReportAuditLogs;
