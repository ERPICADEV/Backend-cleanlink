import { Request, Response } from 'express';
import db from '../config/sqlite';
import { randomUUID } from 'crypto';
import { calculateLevel, LEVEL_CONFIG } from '../utils/levelConfig';
import { NotificationService } from '../services/notificationService';

// GET /api/v1/admin/reports
export const getAdminReports = async (req: Request, res: Response) => {
  try {
    const { 
      region, 
      category, 
      status, 
      sort = 'new', 
      limit = 20 
    } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    const adminRegion = (req as any).adminRegion;
    
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
    
    params.push(parseInt(limit as string));

    const stmt = db.prepare(sql);
    const reports = stmt.all(...params) as any[];

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
  } catch (error) {
    console.error('Get admin reports error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch admin reports' },
    });
  }
};

// PATCH /api/v1/admin/reports/:id/assign
export const assignReport = async (req: Request, res: Response) => {
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
    const reportStmt = db.prepare('SELECT * FROM reports WHERE id = ?');
    const report: any = reportStmt.get(id);

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Update report
    const updateStmt = db.prepare(`
      UPDATE reports 
      SET status = 'assigned', mcd_verified_by = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    updateStmt.run(req.userId, id);

    // Create audit log
    const auditLogId = randomUUID();
    const auditStmt = db.prepare(`
      INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    auditStmt.run(
      auditLogId,
      req.userId!,
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
    );

    return res.status(200).json({
      id: id,
      status: 'assigned',
      assigned_to,
      assigned_by: req.userId,
      assigned_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Assign report error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to assign report' },
    });
  }
};

// PATCH /api/v1/admin/reports/:id/resolve
export const resolveReport = async (req: Request, res: Response) => {
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
    const reportStmt = db.prepare(`
      SELECT 
        r.*,
        u.civic_points, u.civic_level
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      WHERE r.id = ?
    `);
    const report: any = reportStmt.get(id);

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Get comments count
    const commentsStmt = db.prepare('SELECT COUNT(*) as count FROM comments WHERE report_id = ?');
    const commentsCount: any = commentsStmt.get(id);

    let totalPoints = 0;
    let pointsBreakdown: any = {};

    // Transaction for atomic operations
    db.transaction(() => {
      // 1. Update report as resolved
      const mcdResolution = {
        cleaned_image_url,
        notes: notes || '',
        resolved_at: new Date().toISOString(),
        resolved_by: req.userId,
      };

      const updateReportStmt = db.prepare(`
        UPDATE reports 
        SET status = 'resolved', mcd_verified_by = ?, mcd_resolution = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      updateReportStmt.run(
        req.userId,
        JSON.stringify(mcdResolution),
        id
      );
      
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
        const engagementScore = Math.min(
          (report.upvotes * 2) + (commentsCount.count || 0),
          25
        );

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
        const updateUserStmt = db.prepare('UPDATE users SET civic_points = civic_points + ? WHERE id = ?');
        updateUserStmt.run(totalPoints, report.reporter_id);

        // 3. Level update
        const newTotalPoints = (report.civic_points || 0) + totalPoints;
        const previousLevel = report.civic_level || 1;
        const newLevel = calculateLevel(newTotalPoints);

        if (newLevel !== previousLevel) {
          const updateLevelStmt = db.prepare('UPDATE users SET civic_level = ? WHERE id = ?');
          updateLevelStmt.run(newLevel, report.reporter_id);

          console.log(`🎉 User ${report.reporter_id} leveled up: ${previousLevel} → ${newLevel}`);

          // Audit log for level up
          const levelAuditId = randomUUID();
          const levelAuditStmt = db.prepare(`
            INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `);

          levelAuditStmt.run(
            levelAuditId,
            req.userId!,
            'USER_LEVEL_UP',
            'USER',
            report.reporter_id,
            JSON.stringify({
              old_level: previousLevel,
              new_level: newLevel,
              points: newTotalPoints,
            })
          );

          // Notify about level up
          if (newLevel > previousLevel) {
            const levelName = LEVEL_CONFIG[newLevel as keyof typeof LEVEL_CONFIG]?.name || 'New Level';
            NotificationService.notifyLevelUp(report.reporter_id, newLevel, levelName);
          }
        }

        // Notify about report resolution and points
        NotificationService.notifyReportResolved(
          report.reporter_id,
          id,
          totalPoints,
          newLevel
        );

        // Audit log for points awarded
        const pointsAuditId = randomUUID();
        const pointsAuditStmt = db.prepare(`
          INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        pointsAuditStmt.run(
          pointsAuditId,
          req.userId!,
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
        );
      }

      // 4. Audit log for resolution
      const resolutionAuditId = randomUUID();
      const resolutionAuditStmt = db.prepare(`
        INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      resolutionAuditStmt.run(
        resolutionAuditId,
        req.userId!,
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
      );
    })();

    return res.status(200).json({
      id,
      status: 'resolved',
      resolved_by: req.userId,
      resolved_at: new Date().toISOString(),
      points_awarded: report.reporter_id ? totalPoints : 0,
      points_breakdown: report.reporter_id ? pointsBreakdown : null,
    });
  } catch (error) {
    console.error('Resolve report error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve report' },
    });
  }
};

// GET /api/v1/admin/audit/reports/:id
export const getReportAuditLogs = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;

    // Check if report exists
    const reportStmt = db.prepare('SELECT id FROM reports WHERE id = ?');
    const report: any = reportStmt.get(id);

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    const auditStmt = db.prepare(`
      SELECT 
        al.*,
        u.username, u.email
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_id = u.id
      WHERE al.target_type = 'REPORT' AND al.target_id = ?
      ORDER BY al.created_at DESC
      LIMIT ?
    `);
    const auditLogs = auditStmt.all(id, parseInt(limit as string)) as any[];

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
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit logs' },
    });
  }
};