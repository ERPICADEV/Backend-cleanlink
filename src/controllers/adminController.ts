import { Request, Response } from 'express';
import prisma from '../config/database';
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
      cursor, 
      limit = 20 
    } = req.query;

    const where: any = {};
    const adminRegion = (req as any).adminRegion;
    
    // Filter by admin's assigned region if specified
    if (adminRegion && adminRegion.city) {
      // This is a simplified approach - you might need a better region matching logic
      where.reporter = {
        region: {
          path: ['city'],
          equals: adminRegion.city
        }
      };
    }
    
    if (category) where.category = category;
    if (status) where.status = status;

    const orderBy: any = {};
    switch (sort) {
      case 'hot':
        orderBy.communityScore = 'desc';
        break;
      case 'top':
        orderBy.upvotes = 'desc';
        break;
      case 'priority':
        orderBy.createdAt = 'asc'; // Oldest first for priority
        break;
      default: // 'new'
        orderBy.createdAt = 'desc';
    }

    const reports = await prisma.report.findMany({
      where,
      orderBy,
      take: parseInt(limit as string) + 1,
      cursor: cursor ? { id: cursor as string } : undefined,
      include: {
        reporter: {
          select: {
            id: true,
            username: true,
            email: true,
            phone: true,
            region: true,
          },
        },
        _count: {
          select: { 
            comments: true,
            votes: true
          }
        },
      },
    });

    let nextCursor = undefined;
    if (reports.length > parseInt(limit as string)) {
      nextCursor = reports[reports.length - 1].id;
      reports.pop();
    }

    const formattedReports = reports.map(report => ({
      ...report,
      comments_count: report._count.comments,
      votes_count: report._count.votes,
    }));

    return res.status(200).json({
      data: formattedReports,
      paging: nextCursor ? { next_cursor: nextCursor } : null
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

    const report = await prisma.report.findUnique({
      where: { id },
    });

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    const updatedReport = await prisma.report.update({
      where: { id },
      data: {
        status: 'assigned',
        mcdVerifiedBy: req.userId,
      },
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        actorId: req.userId!,
        actionType: 'REPORT_ASSIGNED',
        targetType: 'REPORT',
        targetId: id,
        details: {
          assigned_to,
          notes: notes || '',
          previous_status: report.status,
          new_status: 'assigned',
          assigned_by: req.userId,
        },
      },
    });

    return res.status(200).json({
      id: updatedReport.id,
      status: updatedReport.status,
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
// PATCH /api/v1/admin/reports/:id/resolve
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

    const report = await prisma.report.findUnique({
      where: { id },
      include: {
        reporter: {
          select: {
            id: true,
            civicPoints: true,
            civicLevel: true,
          },
        },
        _count: {
          select: { comments: true }
        },
      },
    });

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    let totalPoints = 0;
    let pointsBreakdown: any = {};

    await prisma.$transaction(async (tx) => {

      // -----------------------------
      // 1. Update report as resolved
      // -----------------------------
      await tx.report.update({
        where: { id },
        data: {
          status: 'resolved',
          mcdVerifiedBy: req.userId,
          mcdResolution: {
            cleaned_image_url,
            notes: notes || '',
            resolved_at: new Date().toISOString(),
            resolved_by: req.userId,
          },
        },
      });
      
      // -------------------------------------------------------
      // 2. Award civic points (only if non-anonymous reporter)
      // -------------------------------------------------------
      if (report.reporterId && report.reporter) {
        const basePoints = 30;

        // AI Confidence Bonus (0–20)
        const aiScore = report.aiScore as any;
        const aiConfidence = aiScore?.legit || 0.5;
        const aiBonus = Math.floor(aiConfidence * 20);

        // Severity Bonus (0–15)
        const severity = aiScore?.severity || 0.5;
        const severityBonus = Math.floor(severity * 15);

        // Engagement Bonus (0–25)
        const engagementScore = Math.min(
          (report.upvotes * 2) + (report._count?.comments || 0),
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
        await tx.user.update({
          where: { id: report.reporterId },
          data: {
            civicPoints: {
              increment: totalPoints,
            },
          },
        });

        // -------------------------------------------------------
        // 3. LEVEL UPDATE (NEW LOGIC)
        // -------------------------------------------------------
        const newTotalPoints = report.reporter.civicPoints + totalPoints;

        const previousLevel = report.reporter.civicLevel;
        const newLevel = calculateLevel(newTotalPoints);

        if (newLevel !== previousLevel) {
          await tx.user.update({
            where: { id: report.reporterId },
            data: { civicLevel: newLevel }
          });

          console.log(`🎉 User ${report.reporterId} leveled up: ${previousLevel} → ${newLevel}`);

          // OPTIONAL: add an audit log entry for level-up
          await tx.auditLog.create({
            data: {
              actorId: req.userId!,
              actionType: 'USER_LEVEL_UP',
              targetType: 'USER',
              targetId: report.reporterId,
              details: {
                old_level: previousLevel,
                new_level: newLevel,
                points: newTotalPoints,
              },
            },
          });
        }
        // -------------------------------------------------------

// After points are awarded, add notifications:
if (report.reporterId) {
  // Notify about report resolution and points
  await NotificationService.notifyReportResolved(
    report.reporterId,
    id,
    totalPoints,
    newLevel
  );

  // Notify about level up if it happened
  if (newLevel > previousLevel) {
    const levelName = LEVEL_CONFIG[newLevel as keyof typeof LEVEL_CONFIG]?.name || 'New Level';
    await NotificationService.notifyLevelUp(report.reporterId, newLevel, levelName);
  }
}

        // Audit log for points awarded
        await tx.auditLog.create({
          data: {
            actorId: req.userId!,
            actionType: 'POINTS_AWARDED',
            targetType: 'USER',
            targetId: report.reporterId,
            details: {
              points_awarded: totalPoints,
              reason: 'report_resolved',
              report_id: id,
              total_points: newTotalPoints,
              points_breakdown: pointsBreakdown,
            },
          },
        });
      }

      // -----------------------------
      // 4. Audit log for resolution
      // -----------------------------
      await tx.auditLog.create({
        data: {
          actorId: req.userId!,
          actionType: 'REPORT_RESOLVED',
          targetType: 'REPORT',
          targetId: id,
          details: {
            cleaned_image_url,
            notes: notes || '',
            previous_status: report.status,
            new_status: 'resolved',
            resolved_by: req.userId,
            points_awarded: report.reporterId ? totalPoints : 0,
          },
        },
      });
    });

    // -----------------------------
    // 5. Response
    // -----------------------------
    return res.status(200).json({
      id,
      status: 'resolved',
      resolved_by: req.userId,
      resolved_at: new Date().toISOString(),
      points_awarded: report.reporterId ? totalPoints : 0,
      points_breakdown: report.reporterId ? pointsBreakdown : null,
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
    const { limit = 50, cursor } = req.query;

    // Check if report exists
    const report = await prisma.report.findUnique({
      where: { id },
    });

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        targetType: 'REPORT',
        targetId: id,
      },
      take: parseInt(limit as string) + 1,
      cursor: cursor ? { id: cursor as string } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    let nextCursor = undefined;
    if (auditLogs.length > parseInt(limit as string)) {
      nextCursor = auditLogs[auditLogs.length - 1].id;
      auditLogs.pop();
    }

    return res.status(200).json({
      data: auditLogs,
      paging: nextCursor ? { next_cursor: nextCursor } : null,
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit logs' },
    });
  }
};