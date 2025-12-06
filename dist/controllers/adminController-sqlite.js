"use strict";
// src/controllers/adminController-sqlite.ts
// 🔄 UPDATED WITH ROLE-BASED PERMISSIONS
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectReportWork = exports.approveReportWork = exports.getPendingApprovals = exports.submitForApproval = exports.updateReportProgress = exports.getAssignedReports = exports.getAdminStats = exports.getAdminUsers = exports.getReportAuditLogs = exports.resolveReport = exports.assignReport = exports.getAdminReports = void 0;
const postgres_1 = require("../config/postgres");
const crypto_1 = require("crypto");
const levelConfig_1 = require("../utils/levelConfig");
const notificationService_1 = require("../services/notificationService");
// ==================== UPDATED: GET /api/v1/admin/reports ====================
const getAdminReports = async (req, res) => {
    try {
        const { region, category, status, sort = 'new', limit = 20 } = req.query;
        let whereClause = 'WHERE 1=1';
        const params = [];
        const adminRegion = req.adminRegion;
        // 🔒 NEW: If not SuperAdmin, only show assigned reports
        if (req.adminRole !== 'superadmin') {
            whereClause += ` AND r.id IN (
        SELECT report_id FROM report_progress WHERE admin_id = ?
      )`;
            params.push(req.adminId);
        }
        // Filter by admin's assigned region if specified
        if (adminRegion && adminRegion.city) {
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
        let orderBy = 'ORDER BY r.created_at DESC';
        switch (sort) {
            case 'hot':
                orderBy = 'ORDER BY r.community_score DESC';
                break;
            case 'top':
                orderBy = 'ORDER BY r.upvotes DESC';
                break;
            case 'priority':
                orderBy = 'ORDER BY r.created_at ASC'; // Oldest first for priority
                break;
        }
        const sql = `
      SELECT 
        r.*,
        u.username, u.email, u.phone, u.region as user_region,
        rp.admin_id as assigned_to,
        assigned_admin.username as assigned_admin_name,
        assigned_admin.email as assigned_admin_email,
        (SELECT COUNT(*) FROM comments c WHERE c.report_id = r.id) as comments_count,
        (SELECT COUNT(*) FROM votes v WHERE v.report_id = r.id) as votes_count
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      LEFT JOIN report_progress rp ON r.id = rp.report_id
      LEFT JOIN admins a ON rp.admin_id = a.id
      LEFT JOIN users assigned_admin ON a.user_id = assigned_admin.id
      ${whereClause}
      ${orderBy}
      LIMIT ?
    `;
        params.push(parseInt(limit));
        // Convert ? placeholders to $1, $2, etc. for PostgreSQL
        let paramIndex = 1;
        const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
        const result = await postgres_1.pool.query(convertedSql, params);
        const reports = result.rows;
        const formattedReports = reports.map(report => {
            let aiScore = null;
            try {
                if (report.ai_score) {
                    aiScore = JSON.parse(report.ai_score);
                }
            }
            catch (e) {
                console.error('Error parsing ai_score:', e);
            }
            return {
                id: report.id,
                title: report.title,
                description: report.description,
                category: report.category,
                status: report.status,
                upvotes: report.upvotes,
                downvotes: report.downvotes,
                community_score: report.community_score,
                created_at: report.created_at,
                mcd_verified_by: report.mcd_verified_by,
                assigned_to: report.assigned_to,
                assignedToName: report.assigned_admin_name || null,
                aiScore,
                reporter: report.reporter_id ? {
                    id: report.reporter_id,
                    username: report.username,
                    email: report.email,
                    phone: report.phone,
                    region: report.user_region ? (() => {
                        try {
                            return JSON.parse(report.user_region);
                        }
                        catch {
                            return report.user_region;
                        }
                    })() : null,
                } : null,
                comments_count: report.comments_count,
                votes_count: report.votes_count,
            };
        });
        return res.status(200).json({
            data: formattedReports,
            paging: null
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
// ==================== UPDATED: PATCH /api/v1/admin/reports/:id/assign ====================
const assignReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { assigned_to, notes } = req.body;
        // 🔒 NEW: Only SuperAdmin can assign reports
        if (req.adminRole !== 'superadmin') {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Only SuperAdmin can assign reports' },
            });
        }
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
        const reportResult = await postgres_1.pool.query('SELECT * FROM reports WHERE id = $1', [id]);
        const report = reportResult.rows[0];
        if (!report) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        // Verify assigned_to admin exists
        const adminResult = await postgres_1.pool.query('SELECT id FROM admins WHERE id = $1', [assigned_to]);
        const targetAdmin = adminResult.rows[0];
        if (!targetAdmin) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Target admin not found' },
            });
        }
        // 🆕 Create or update report_progress entry
        const progressCheckResult = await postgres_1.pool.query('SELECT id FROM report_progress WHERE report_id = $1', [id]);
        const existingProgress = progressCheckResult.rows[0];
        if (existingProgress) {
            // Update existing assignment
            await postgres_1.pool.query(`
        UPDATE report_progress 
        SET admin_id = $1, notes = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE report_id = $3
      `, [assigned_to, notes || '', id]);
        }
        else {
            // Create new assignment
            await postgres_1.pool.query(`
        INSERT INTO report_progress (id, report_id, admin_id, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [(0, crypto_1.randomUUID)(), id, assigned_to, notes || '']);
        }
        // Update report status
        await postgres_1.pool.query(`
      UPDATE reports 
      SET status = 'assigned', mcd_verified_by = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $2
    `, [req.userId, id]);
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        await postgres_1.pool.query(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [
            auditLogId,
            req.userId,
            'REPORT_ASSIGNED',
            'REPORT',
            id,
            JSON.stringify({
                assigned_to,
                notes: notes || '',
                previous_status: report.status,
                new_status: 'assigned',
                assigned_by: req.userId,
            })
        ]);
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
// ==================== UPDATED: PATCH /api/v1/admin/reports/:id/resolve ====================
const resolveReport = async (req, res) => {
    try {
        const { id } = req.params;
        const { cleaned_image_url, notes } = req.body;
        // 🔒 NEW: Only SuperAdmin can resolve reports
        if (req.adminRole !== 'superadmin') {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Only SuperAdmin can mark reports as resolved' },
            });
        }
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
        const reportResult = await postgres_1.pool.query(`
      SELECT 
        r.*,
        u.civic_points, u.civic_level
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      WHERE r.id = $1
    `, [id]);
        const report = reportResult.rows[0];
        if (!report) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        // 🔒 NEW: Check if report is pending approval (optional - for workflow)
        // Uncomment if you want to enforce workflow
        // if (report.status !== 'pending_approval') {
        //   return res.status(400).json({
        //     error: { code: 'INVALID_STATUS', message: 'Report must be pending approval first' },
        //   })
        // }
        // Get comments count
        const commentsResult = await postgres_1.pool.query('SELECT COUNT(*) as count FROM comments WHERE report_id = $1', [id]);
        const commentsCount = { count: parseInt(commentsResult.rows[0].count) };
        let totalPoints = 0;
        let pointsBreakdown = {};
        // Transaction for atomic operations
        const client = await postgres_1.pool.connect();
        try {
            await client.query('BEGIN');
            // 1. Update report as resolved
            const mcdResolution = {
                cleaned_image_url,
                notes: notes || '',
                resolved_at: new Date().toISOString(),
                resolved_by: req.userId,
            };
            await client.query(`
        UPDATE reports 
        SET status = 'resolved', mcd_verified_by = $1, mcd_resolution = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $3
      `, [
                req.userId,
                JSON.stringify(mcdResolution),
                id
            ]);
            // 2. Award civic points (only if non-anonymous reporter)
            if (report.reporter_id) {
                const basePoints = 30;
                const aiScore = report.ai_score ? JSON.parse(report.ai_score) : {};
                const aiConfidence = aiScore?.legit || 0.5;
                const aiBonus = Math.floor(aiConfidence * 20);
                const severity = aiScore?.severity || 0.5;
                const severityBonus = Math.floor(severity * 15);
                const engagementScore = Math.min((report.upvotes * 2) + (commentsCount.count || 0), 25);
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
                await client.query('UPDATE users SET civic_points = civic_points + $1 WHERE id = $2', [totalPoints, report.reporter_id]);
                const newTotalPoints = (report.civic_points || 0) + totalPoints;
                const previousLevel = report.civic_level || 1;
                const newLevel = (0, levelConfig_1.calculateLevel)(newTotalPoints);
                if (newLevel !== previousLevel) {
                    await client.query('UPDATE users SET civic_level = $1 WHERE id = $2', [newLevel, report.reporter_id]);
                    const levelAuditId = (0, crypto_1.randomUUID)();
                    await client.query(`
            INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
          `, [
                        levelAuditId,
                        req.userId,
                        'USER_LEVEL_UP',
                        'USER',
                        report.reporter_id,
                        JSON.stringify({
                            old_level: previousLevel,
                            new_level: newLevel,
                            points: newTotalPoints,
                        })
                    ]);
                    if (newLevel > previousLevel) {
                        const levelName = levelConfig_1.LEVEL_CONFIG[newLevel]?.name || 'New Level';
                        notificationService_1.NotificationService.notifyLevelUp(report.reporter_id, newLevel, levelName);
                    }
                }
                notificationService_1.NotificationService.notifyReportResolved(report.reporter_id, id, totalPoints, newLevel);
                const pointsAuditId = (0, crypto_1.randomUUID)();
                await client.query(`
          INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        `, [
                    pointsAuditId,
                    req.userId,
                    'POINTS_AWARDED',
                    'USER',
                    report.reporter_id,
                    JSON.stringify({
                        points_awarded: totalPoints,
                        reason: 'report_resolved',
                        report_id: id,
                        total_points: newTotalPoints,
                        points_breakdown: pointsBreakdown,
                    })
                ]);
            }
            // 4. Audit log for resolution
            const resolutionAuditId = (0, crypto_1.randomUUID)();
            await client.query(`
        INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      `, [
                resolutionAuditId,
                req.userId,
                'REPORT_RESOLVED',
                'REPORT',
                id,
                JSON.stringify({
                    cleaned_image_url,
                    notes: notes || '',
                    previous_status: report.status,
                    new_status: 'resolved',
                    resolved_by: req.userId,
                    points_awarded: report.reporter_id ? totalPoints : 0,
                })
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
// ==================== UNCHANGED: Other endpoints ====================
const getReportAuditLogs = async (req, res) => {
    try {
        const { id } = req.params;
        const { limit = 50 } = req.query;
        const reportResult = await postgres_1.pool.query('SELECT id FROM reports WHERE id = $1', [id]);
        const report = reportResult.rows[0];
        if (!report) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        const auditResult = await postgres_1.pool.query(`
      SELECT 
        al.*,
        u.username, u.email
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_id = u.id
      WHERE al.target_type = 'REPORT' AND al.target_id = $1
      ORDER BY al.created_at DESC
      LIMIT $2
    `, [id, parseInt(limit)]);
        const auditLogs = auditResult.rows;
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
            paging: null,
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
const getAdminUsers = async (req, res) => {
    try {
        const result = await postgres_1.pool.query(`
      SELECT 
        a.id,
        a.user_id as userId,
        u.username as name,
        u.email,
        a.region_assigned as region,
        a.role
      FROM admins a
      JOIN users u ON a.user_id = u.id
      WHERE a.role IN ('admin', 'viewer', 'editor')
      ORDER BY u.username ASC
    `);
        const admins = result.rows;
        return res.status(200).json({
            data: admins,
            message: 'Admin users fetched successfully'
        });
    }
    catch (error) {
        console.error('Error fetching admin users:', error);
        return res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch admin users' }
        });
    }
};
exports.getAdminUsers = getAdminUsers;
const getAdminStats = async (req, res) => {
    try {
        const adminRegion = req.adminRegion || null;
        const userId = req.userId || null;
        let pendingResult;
        if (adminRegion) {
            pendingResult = await postgres_1.pool.query(`
        SELECT COUNT(*) as count FROM reports 
        WHERE status = 'pending'
        AND location LIKE $1
      `, [`%${adminRegion.city || adminRegion}%`]);
        }
        else {
            pendingResult = await postgres_1.pool.query(`
        SELECT COUNT(*) as count FROM reports 
        WHERE status = 'pending'
      `);
        }
        const pending = parseInt(pendingResult.rows[0].count);
        let assignedToMe = 0;
        if (userId) {
            const assignedResult = await postgres_1.pool.query(`
        SELECT COUNT(*) as count FROM reports 
        WHERE mcd_verified_by = $1
        AND status = 'assigned'
      `, [userId]);
            assignedToMe = parseInt(assignedResult.rows[0].count);
        }
        const monthAgoStr = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        let resolvedResult;
        if (adminRegion) {
            resolvedResult = await postgres_1.pool.query(`
        SELECT COUNT(*) as count FROM reports 
        WHERE status = 'resolved'
        AND updated_at >= $1
        AND location LIKE $2
      `, [monthAgoStr, `%${adminRegion.city || adminRegion}%`]);
        }
        else {
            resolvedResult = await postgres_1.pool.query(`
        SELECT COUNT(*) as count FROM reports 
        WHERE status = 'resolved'
        AND updated_at >= $1
      `, [monthAgoStr]);
        }
        const resolvedThisMonth = parseInt(resolvedResult.rows[0].count);
        let avgTimeResult;
        if (adminRegion) {
            avgTimeResult = await postgres_1.pool.query(`
        SELECT 
          AVG(
            EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600
          ) as avgHours
        FROM reports 
        WHERE status = 'resolved'
        AND updated_at IS NOT NULL
        AND location LIKE $1
      `, [`%${adminRegion.city || adminRegion}%`]);
        }
        else {
            avgTimeResult = await postgres_1.pool.query(`
        SELECT 
          AVG(
            EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600
          ) as avgHours
        FROM reports 
        WHERE status = 'resolved'
        AND updated_at IS NOT NULL
      `);
        }
        const avgHours = avgTimeResult.rows[0]?.avghours ? Math.round(parseFloat(avgTimeResult.rows[0].avghours) * 10) / 10 : 0;
        const categoryResult = await postgres_1.pool.query(`
      SELECT category, COUNT(*) as count FROM reports
      GROUP BY category
      ORDER BY count DESC
      LIMIT 5
    `);
        const byCategory = categoryResult.rows;
        const recentResult = await postgres_1.pool.query(`
      SELECT id, title, status, updated_at as updatedAt FROM reports
      ORDER BY updated_at DESC
      LIMIT 5
    `);
        const recentActivity = recentResult.rows;
        return res.status(200).json({
            data: {
                pendingReports: pending,
                assignedToYou: assignedToMe,
                resolvedThisMonth,
                avgResolutionTime: `${avgHours} hrs`,
                reportsByCategory: byCategory,
                recentActivity
            }
        });
    }
    catch (error) {
        console.error('Error fetching admin stats:', error);
        return res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch stats' }
        });
    }
};
exports.getAdminStats = getAdminStats;
// Add these 6 NEW functions to src/controllers/adminController-sqlite.ts
// Paste them AFTER the existing functions (before the last export)
// ==================== NEW: GET /api/v1/admin/reports/assigned ====================
// Field admins see ONLY their assigned reports
const getAssignedReports = async (req, res) => {
    try {
        // Only field Admins can access this
        if (req.adminRole !== 'admin') {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Only field admins can use this endpoint' },
            });
        }
        const { status = 'all', sort = 'new', limit = 20 } = req.query;
        let whereClause = 'WHERE rp.admin_id = $1';
        const params = [req.adminId];
        let paramIndex = 2;
        // Filter by progress status
        if (status && status !== 'all') {
            whereClause += ` AND rp.progress_status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        // Sorting
        let orderBy = 'ORDER BY r.created_at DESC';
        switch (sort) {
            case 'hot':
                orderBy = 'ORDER BY r.community_score DESC';
                break;
            case 'top':
                orderBy = 'ORDER BY r.upvotes DESC';
                break;
            case 'priority':
                orderBy = 'ORDER BY r.created_at ASC';
                break;
        }
        const sql = `
      SELECT 
        r.*,
        rp.id as progress_id,
        rp.progress_status,
        rp.notes as progress_notes,
        rp.photos as progress_photos,
        rp.completion_details,
        rp.submitted_at,
        rp.rejection_reason,
        rp.rejected_at,
        u.username, u.email
      FROM reports r
      INNER JOIN report_progress rp ON r.id = rp.report_id
      LEFT JOIN users u ON r.reporter_id = u.id
      ${whereClause}
      ${orderBy}
      LIMIT $${paramIndex}
    `;
        params.push(parseInt(limit));
        const result = await postgres_1.pool.query(sql, params);
        const reports = result.rows;
        const formattedReports = reports.map(report => {
            let aiScore = null;
            try {
                if (report.ai_score) {
                    aiScore = JSON.parse(report.ai_score);
                }
            }
            catch (e) {
                console.error('Error parsing ai_score:', e);
            }
            let progressPhotos = [];
            try {
                if (report.progress_photos) {
                    progressPhotos = JSON.parse(report.progress_photos);
                }
            }
            catch (e) {
                console.error('Error parsing progress_photos:', e);
            }
            return {
                id: report.id,
                title: report.title,
                description: report.description,
                category: report.category,
                status: report.status,
                images: report.images ? JSON.parse(report.images) : [],
                location: report.location ? JSON.parse(report.location) : {},
                created_at: report.created_at,
                aiScore,
                reporter: report.reporter_id ? {
                    id: report.reporter_id,
                    username: report.username,
                    email: report.email,
                } : null,
                progress: {
                    id: report.progress_id,
                    status: report.progress_status,
                    notes: report.progress_notes,
                    photos: progressPhotos,
                    completion_details: report.completion_details,
                    submitted_at: report.submitted_at,
                    rejection_reason: report.rejection_reason,
                    rejected_at: report.rejected_at,
                }
            };
        });
        return res.status(200).json({
            data: formattedReports,
            paging: null
        });
    }
    catch (error) {
        console.error('Error fetching assigned reports:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch assigned reports' },
        });
    }
};
exports.getAssignedReports = getAssignedReports;
// ==================== NEW: PATCH /api/v1/admin/reports/:id/progress ====================
// Field admin updates their work progress
const updateReportProgress = async (req, res) => {
    try {
        const { id: reportId } = req.params;
        const { progress_status, notes, photos, completion_details } = req.body;
        // Only field Admins can update progress
        if (req.adminRole !== 'admin') {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Only field admins can update progress' },
            });
        }
        // Check if report is assigned to this admin
        const assignmentResult = await postgres_1.pool.query(`
      SELECT id FROM report_progress WHERE report_id = $1 AND admin_id = $2
    `, [reportId, req.adminId]);
        const assignment = assignmentResult.rows[0];
        if (!assignment) {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Report not assigned to you' },
            });
        }
        // Validate progress status if provided
        const validStatuses = ['not_started', 'in_progress', 'submitted_for_approval'];
        if (progress_status && !validStatuses.includes(progress_status)) {
            return res.status(400).json({
                error: { code: 'INVALID_STATUS', message: 'Invalid progress status' },
            });
        }
        // Build update query
        const updates = [];
        const params = [];
        let paramIndex = 1;
        if (progress_status) {
            updates.push(`progress_status = $${paramIndex}`);
            params.push(progress_status);
            paramIndex++;
        }
        if (notes !== undefined) {
            updates.push(`notes = $${paramIndex}`);
            params.push(notes);
            paramIndex++;
        }
        if (photos) {
            updates.push(`photos = $${paramIndex}`);
            params.push(JSON.stringify(photos));
            paramIndex++;
        }
        if (completion_details !== undefined) {
            updates.push(`completion_details = $${paramIndex}`);
            params.push(completion_details);
            paramIndex++;
        }
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(reportId, req.adminId);
        const updateSql = `
      UPDATE report_progress 
      SET ${updates.join(', ')}
      WHERE report_id = $${paramIndex} AND admin_id = $${paramIndex + 1}
    `;
        await postgres_1.pool.query(updateSql, params);
        // If progress_status is 'in_progress', update report status
        if (progress_status === 'in_progress') {
            await postgres_1.pool.query('UPDATE reports SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', ['in_progress', reportId]);
        }
        return res.status(200).json({
            success: true,
            message: 'Progress updated successfully',
        });
    }
    catch (error) {
        console.error('Error updating progress:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to update progress' },
        });
    }
};
exports.updateReportProgress = updateReportProgress;
// ==================== NEW: PATCH /api/v1/admin/reports/:id/submit-approval ====================
// Field admin submits completed work for SuperAdmin approval
const submitForApproval = async (req, res) => {
    try {
        const { id: reportId } = req.params;
        const { completion_details, photos } = req.body;
        // Only field Admins can submit
        if (req.adminRole !== 'admin') {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Only field admins can submit for approval' },
            });
        }
        // Check if report is assigned to this admin
        const progressResult = await postgres_1.pool.query(`
      SELECT * FROM report_progress WHERE report_id = $1 AND admin_id = $2
    `, [reportId, req.adminId]);
        const progress = progressResult.rows[0];
        if (!progress) {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Report not assigned to you' },
            });
        }
        // Validate required fields
        if (!completion_details || completion_details.trim().length < 20) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Completion details required (minimum 20 characters)',
                },
            });
        }
        // Update progress - set to submitted
        await postgres_1.pool.query(`
      UPDATE report_progress
      SET 
        progress_status = 'submitted_for_approval',
        completion_details = $1,
        photos = $2,
        submitted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE report_id = $3 AND admin_id = $4
    `, [
            completion_details,
            photos ? JSON.stringify(photos) : '[]',
            reportId,
            req.adminId
        ]);
        // Update report status - pending approval
        await postgres_1.pool.query(`
      UPDATE reports
      SET status = 'pending_approval', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [reportId]);
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        await postgres_1.pool.query(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [
            auditLogId,
            req.userId,
            'WORK_SUBMITTED',
            'REPORT',
            reportId,
            JSON.stringify({
                admin_id: req.adminId,
                completion_details,
                photos: photos || [],
            })
        ]);
        return res.status(200).json({
            success: true,
            message: 'Report submitted for approval',
        });
    }
    catch (error) {
        console.error('Error submitting for approval:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to submit for approval' },
        });
    }
};
exports.submitForApproval = submitForApproval;
// ==================== NEW: GET /api/v1/admin/pending-approvals ====================
// SuperAdmin views all work pending approval
const getPendingApprovals = async (req, res) => {
    try {
        // Only SuperAdmin can view pending approvals
        if (req.adminRole !== 'superadmin') {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Only SuperAdmin can view pending approvals' },
            });
        }
        const { limit = 20 } = req.query;
        const sql = `
      SELECT 
        r.*,
        rp.id as progress_id,
        rp.notes,
        rp.photos,
        rp.completion_details,
        rp.submitted_at,
        rp.admin_id,
        a.user_id as admin_user_id,
        u.username as admin_name,
        u.email as admin_email
      FROM reports r
      INNER JOIN report_progress rp ON r.id = rp.report_id
      INNER JOIN admins a ON rp.admin_id = a.id
      INNER JOIN users u ON a.user_id = u.id
      WHERE r.status = 'pending_approval'
      ORDER BY rp.submitted_at DESC
      LIMIT ?
    `;
        // Convert ? placeholders to $1, $2, etc. for PostgreSQL
        let paramIndex = 1;
        const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
        const result = await postgres_1.pool.query(convertedSql, [parseInt(limit)]);
        const approvals = result.rows;
        const formattedApprovals = approvals.map(item => {
            let aiScore = null;
            try {
                if (item.ai_score) {
                    aiScore = JSON.parse(item.ai_score);
                }
            }
            catch (e) {
                console.error('Error parsing ai_score:', e);
            }
            let photos = [];
            try {
                if (item.photos) {
                    photos = JSON.parse(item.photos);
                }
            }
            catch (e) {
                console.error('Error parsing photos:', e);
            }
            return {
                id: item.id,
                title: item.title,
                description: item.description,
                category: item.category,
                status: item.status,
                images: item.images ? JSON.parse(item.images) : [],
                location: item.location ? JSON.parse(item.location) : {},
                created_at: item.created_at,
                aiScore,
                progress: {
                    id: item.progress_id,
                    notes: item.notes,
                    photos: photos,
                    completion_details: item.completion_details,
                    submitted_at: item.submitted_at,
                    admin: {
                        id: item.admin_id,
                        user_id: item.admin_user_id,
                        name: item.admin_name,
                        email: item.admin_email,
                    }
                }
            };
        });
        return res.status(200).json({
            data: formattedApprovals,
            paging: null
        });
    }
    catch (error) {
        console.error('Error fetching pending approvals:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch pending approvals' },
        });
    }
};
exports.getPendingApprovals = getPendingApprovals;
// ==================== NEW: PATCH /api/v1/admin/reports/:id/approve ====================
// SuperAdmin approves completed work & marks report as resolved
const approveReportWork = async (req, res) => {
    try {
        const { id: reportId } = req.params;
        // Only SuperAdmin can approve
        if (req.adminRole !== 'superadmin') {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Only SuperAdmin can approve work' },
            });
        }
        // Check if report is pending approval
        const reportResult = await postgres_1.pool.query('SELECT * FROM reports WHERE id = $1', [reportId]);
        const report = reportResult.rows[0];
        if (!report) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        if (report.status !== 'pending_approval') {
            return res.status(400).json({
                error: { code: 'INVALID_STATUS', message: 'Report is not pending approval' },
            });
        }
        // Update report - mark as resolved
        await postgres_1.pool.query(`
      UPDATE reports
      SET 
        status = 'resolved',
        mcd_verified_by = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [req.userId, reportId]);
        // Update progress - mark as approved
        await postgres_1.pool.query(`
      UPDATE report_progress
      SET 
        approved_at = CURRENT_TIMESTAMP,
        approved_by = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE report_id = $2
    `, [req.adminId, reportId]);
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        await postgres_1.pool.query(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [
            auditLogId,
            req.userId,
            'WORK_APPROVED',
            'REPORT',
            reportId,
            JSON.stringify({
                approved_by: req.adminId,
                previous_status: report.status,
                new_status: 'resolved',
            })
        ]);
        return res.status(200).json({
            success: true,
            message: 'Report approved and marked as resolved',
        });
    }
    catch (error) {
        console.error('Error approving report:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to approve report' },
        });
    }
};
exports.approveReportWork = approveReportWork;
// ==================== NEW: PATCH /api/v1/admin/reports/:id/reject ====================
// SuperAdmin rejects work & sends back to field admin for revision
const rejectReportWork = async (req, res) => {
    try {
        const { id: reportId } = req.params;
        const { rejection_reason } = req.body;
        // Only SuperAdmin can reject
        if (req.adminRole !== 'superadmin') {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Only SuperAdmin can reject work' },
            });
        }
        // Validate rejection reason
        if (!rejection_reason || rejection_reason.trim().length < 10) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Rejection reason required (minimum 10 characters)',
                },
            });
        }
        // Check if report is pending approval
        const reportResult = await postgres_1.pool.query('SELECT * FROM reports WHERE id = $1', [reportId]);
        const report = reportResult.rows[0];
        if (!report) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        if (report.status !== 'pending_approval') {
            return res.status(400).json({
                error: { code: 'INVALID_STATUS', message: 'Report is not pending approval' },
            });
        }
        // Update report - back to assigned
        await postgres_1.pool.query(`
      UPDATE reports
      SET status = 'assigned', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [reportId]);
        // Update progress - mark as rejected
        await postgres_1.pool.query(`
      UPDATE report_progress
      SET 
        rejection_reason = $1,
        rejected_at = CURRENT_TIMESTAMP,
        progress_status = 'in_progress',
        updated_at = CURRENT_TIMESTAMP
      WHERE report_id = $2
    `, [rejection_reason, reportId]);
        // Create audit log
        const auditLogId = (0, crypto_1.randomUUID)();
        await postgres_1.pool.query(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [
            auditLogId,
            req.userId,
            'WORK_REJECTED',
            'REPORT',
            reportId,
            JSON.stringify({
                rejected_by: req.adminId,
                rejection_reason,
                previous_status: report.status,
                new_status: 'assigned',
            })
        ]);
        return res.status(200).json({
            success: true,
            message: 'Work rejected - admin must revise',
        });
    }
    catch (error) {
        console.error('Error rejecting report:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to reject report' },
        });
    }
};
exports.rejectReportWork = rejectReportWork;
