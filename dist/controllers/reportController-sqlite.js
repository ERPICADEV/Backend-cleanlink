"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateReport = exports.getReport = exports.createReport = exports.getReports = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const crypto_1 = require("crypto");
const queue_1 = require("../utils/queue");
// GET /api/v1/reports (feed)
const getReports = async (req, res) => {
    try {
        const { category, status, sort = 'new', limit = 20, reporter_id } = req.query;
        // Build WHERE clause
        let whereClause = 'WHERE 1=1';
        const params = [];
        if (typeof category === 'string' && category.trim()) {
            whereClause += ' AND LOWER(category) = LOWER(?)';
            params.push(category.trim());
        }
        if (typeof status === 'string' && status.trim()) {
            whereClause += ' AND LOWER(status) = LOWER(?)';
            params.push(status.trim());
        }
        if (typeof reporter_id === 'string' && reporter_id.trim()) {
            whereClause += ' AND reporter_id = ?';
            params.push(reporter_id.trim());
        }
        // Build ORDER BY
        let orderBy = 'ORDER BY created_at DESC';
        switch (sort) {
            case 'hot':
                orderBy = 'ORDER BY community_score DESC';
                break;
            case 'top':
                orderBy = 'ORDER BY upvotes DESC';
                break;
        }
        const sql = `
      SELECT 
        id, title, description, category, images, location, visibility,
        upvotes, downvotes, community_score, status, created_at, 
        reporter_id, reporter_display,
        (SELECT COUNT(*) FROM comments WHERE report_id = reports.id) as comments_count
      FROM reports 
      ${whereClause}
      ${orderBy}
      LIMIT ?
    `;
        params.push(parseInt(limit));
        const stmt = sqlite_1.default.prepare(sql);
        const reports = stmt.all(...params);
        // Mask coordinates for public feed
        const maskedReports = reports.map((report) => {
            const reportData = { ...report };
            // Parse JSON fields
            if (reportData.images) {
                reportData.images = JSON.parse(reportData.images);
            }
            if (reportData.location) {
                reportData.location = JSON.parse(reportData.location);
                // Mask coordinates if visibility is masked
                if (reportData.visibility === 'masked' && reportData.location) {
                    const { lat, lng, ...restLocation } = reportData.location;
                    reportData.location = restLocation;
                }
            }
            return {
                ...reportData,
                description_preview: reportData.description.substring(0, 100) + (reportData.description.length > 100 ? '...' : '')
            };
        });
        return res.status(200).json({
            data: maskedReports,
            paging: null // Simplified - remove cursor for now
        });
    }
    catch (error) {
        console.error('Get reports error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch reports' },
        });
    }
};
exports.getReports = getReports;
// POST /api/v1/reports
const createReport = async (req, res) => {
    try {
        const { title, description, category, images, location, anonymous = false, client_idempotency_key } = req.body;
        const reporterId = anonymous ? null : req.userId;
        const reporterDisplay = anonymous ? 'Anonymous' : req.userEmail || 'User';
        const reportId = (0, crypto_1.randomUUID)();
        const insertStmt = sqlite_1.default.prepare(`
      INSERT INTO reports (
        id, title, description, category, images, location, visibility,
        reporter_id, reporter_display, community_score, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
        insertStmt.run(reportId, title.trim(), description.trim(), category, JSON.stringify(images || []), JSON.stringify(location || {}), location?.visibility || 'public', reporterId, reporterDisplay, 0, // community_score
        'pending' // status
        );
        console.log('✅ Report created:', reportId);
        console.log('📋 Calling enqueueAIAnalysis...');
        try {
            await (0, queue_1.enqueueAIAnalysis)(reportId);
            console.log('🎯 AI queuing completed for report:', reportId);
        }
        catch (aiError) {
            console.error('❌ Failed to enqueue AI analysis:', aiError);
        }
        return res.status(201).json({
            id: reportId,
            status: 'pending',
            ai_check: 'queued',
            created_at: new Date().toISOString(),
            points_awarded: 0
        });
    }
    catch (error) {
        console.error('Create report error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to create report' },
        });
    }
};
exports.createReport = createReport;
// GET /api/v1/reports/:id
const getReport = async (req, res) => {
    try {
        const { id } = req.params;
        // Check if user is admin (simplified)
        let isAdmin = false;
        if (req.userId) {
            const adminStmt = sqlite_1.default.prepare('SELECT 1 FROM admins WHERE user_id = ?');
            const admin = adminStmt.get(req.userId);
            isAdmin = !!admin;
        }
        // Get report
        const reportStmt = sqlite_1.default.prepare(`
      SELECT * FROM reports WHERE id = ?
    `);
        const report = reportStmt.get(id);
        if (!report) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        // Get reporter info
        let reporter = null;
        if (report.reporter_id) {
            const reporterStmt = sqlite_1.default.prepare(`
        SELECT id, username, ${isAdmin ? 'email,' : ''} badges 
        FROM users WHERE id = ?
      `);
            reporter = reporterStmt.get(report.reporter_id);
        }
        // Get comments with authors
        const commentsStmt = sqlite_1.default.prepare(`
      SELECT c.*, u.username, u.badges 
      FROM comments c 
      LEFT JOIN users u ON c.author_id = u.id 
      WHERE c.report_id = ? 
      ORDER BY c.created_at ASC
    `);
        const rawComments = commentsStmt.all(id);
        // Format comments to match getComments endpoint structure
        const formatComment = (comment) => {
            const formatted = {
                id: comment.id,
                text: comment.text,
                author: {
                    id: comment.author_id,
                    username: comment.username || 'Anonymous',
                    badges: comment.badges ? JSON.parse(comment.badges) : [],
                },
                parent_comment_id: comment.parent_comment_id,
                created_at: comment.created_at,
                updated_at: comment.updated_at,
            };
            // Get replies recursively
            const repliesStmt = sqlite_1.default.prepare(`
        SELECT c.*, u.username, u.badges 
        FROM comments c 
        LEFT JOIN users u ON c.author_id = u.id 
        WHERE c.parent_comment_id = ?
        ORDER BY c.created_at ASC
      `);
            const replies = repliesStmt.all(comment.id);
            if (replies.length > 0) {
                formatted.replies = replies.map((reply) => formatComment(reply));
            }
            return formatted;
        };
        // Get top-level comments (no parent) and format them
        const topLevelComments = rawComments.filter((c) => !c.parent_comment_id);
        const comments = topLevelComments.map((comment) => formatComment(comment));
        // Get votes count
        const votesStmt = sqlite_1.default.prepare('SELECT COUNT(*) as count FROM votes WHERE report_id = ?');
        const votesCount = votesStmt.get(id);
        // Parse JSON fields
        const responseReport = {
            ...report,
            images: report.images ? JSON.parse(report.images) : [],
            location: report.location ? JSON.parse(report.location) : {},
            reporter,
            comments,
            _count: {
                votes: votesCount.count
            }
        };
        // Mask coordinates for non-admin users
        if (!isAdmin && report.visibility === 'masked' && responseReport.location) {
            const { lat, lng, ...restLocation } = responseReport.location;
            responseReport.location = restLocation;
        }
        // Hide reporter email for non-admin
        if (!isAdmin && responseReport.reporter) {
            delete responseReport.reporter.email;
        }
        return res.status(200).json(responseReport);
    }
    catch (error) {
        console.error('Get report error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch report' },
        });
    }
};
exports.getReport = getReport;
// PATCH /api/v1/reports/:id
const updateReport = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        // Check if user is admin
        let isAdmin = false;
        if (req.userId) {
            const adminStmt = sqlite_1.default.prepare('SELECT 1 FROM admins WHERE user_id = ?');
            const admin = adminStmt.get(req.userId);
            isAdmin = !!admin;
        }
        // Get existing report
        const getStmt = sqlite_1.default.prepare('SELECT * FROM reports WHERE id = ?');
        const existingReport = getStmt.get(id);
        if (!existingReport) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Report not found' },
            });
        }
        // Authorization: Only reporter or admin can update
        const isReporter = existingReport.reporter_id === req.userId;
        if (!isReporter && !isAdmin) {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Not authorized to update this report' },
            });
        }
        // Reporter can only edit pending reports
        if (isReporter && existingReport.status !== 'pending') {
            return res.status(400).json({
                error: { code: 'VALIDATION_ERROR', message: 'Can only edit pending reports' },
            });
        }
        // Build update query
        const updateFields = [];
        const updateParams = [];
        Object.keys(updates).forEach(key => {
            if (key === 'images' || key === 'location') {
                updateFields.push(`${key} = ?`);
                updateParams.push(JSON.stringify(updates[key]));
            }
            else {
                updateFields.push(`${key} = ?`);
                updateParams.push(updates[key]);
            }
        });
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        const updateSql = `UPDATE reports SET ${updateFields.join(', ')} WHERE id = ?`;
        updateParams.push(id);
        const updateStmt = sqlite_1.default.prepare(updateSql);
        updateStmt.run(...updateParams);
        // Get updated report
        const updatedReportStmt = sqlite_1.default.prepare('SELECT * FROM reports WHERE id = ?');
        const updatedReport = updatedReportStmt.get(id);
        // Parse JSON fields
        if (updatedReport.images) {
            updatedReport.images = JSON.parse(updatedReport.images);
        }
        if (updatedReport.location) {
            updatedReport.location = JSON.parse(updatedReport.location);
        }
        return res.status(200).json(updatedReport);
    }
    catch (error) {
        console.error('Update report error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to update report' },
        });
    }
};
exports.updateReport = updateReport;
function calculateCommunityScore(upvotes, downvotes) {
    const total = upvotes + downvotes;
    if (total === 0)
        return 0;
    return (upvotes - downvotes) / total;
}
