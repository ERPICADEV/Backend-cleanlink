import { Request, Response } from 'express';
import prisma from '../config/database';

// POST /internal/ai/reports/:id/result - Internal AI service
export const updateAIResult = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      ai_score, 
      duplicate_of, 
      insights,
      duplicate_prob 
    } = req.body;

    // Validate required fields
    if (!ai_score || typeof ai_score.legit !== 'number') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'ai_score with legit probability is required',
        },
      });
    }

    // Check if report exists
    const report = await prisma.report.findUnique({
      where: { id },
    });

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    await prisma.$transaction(async (tx) => {
      // Update AI score and insights
      const updateData: any = {
        aiScore: {
          legit: ai_score.legit,
          severity: ai_score.severity || 0.5,
          duplicate_prob: duplicate_prob || 0,
          insights: insights || [],
          processed_at: new Date().toISOString(),
        },
      };

      // Handle duplicate detection
      if (duplicate_of) {
        const duplicateReport = await tx.report.findUnique({
          where: { id: duplicate_of },
        });

        if (duplicateReport) {
          updateData.status = 'duplicate';
          updateData.duplicateOf = duplicate_of;
        }
      }

      // Auto-flag reports with low legitimacy score
      if (ai_score.legit < 0.3) {
        updateData.status = 'flagged';
      } else if (ai_score.legit > 0.7 && report.status === 'pending') {
        updateData.status = 'community_verified';
      }

      // Update the report
      await tx.report.update({
        where: { id },
        data: updateData,
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          actorId: null, // System action
          actionType: 'AI_ANALYSIS_COMPLETE',
          targetType: 'REPORT',
          targetId: id,
          details: {
            ai_score: ai_score.legit,
            severity: ai_score.severity,
            duplicate_of,
            new_status: updateData.status,
            insights: insights || [],
          },
        },
      });
    });

    return res.status(200).json({
      message: 'AI results updated successfully',
      report_id: id,
      status: 'processed',
    });
  } catch (error) {
    console.error('Update AI result error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update AI results' },
    });
  }
};

// GET /internal/ai/reports/pending - Get reports for AI processing
export const getPendingAIReports = async (req: Request, res: Response) => {
  try {
    const { limit = 10 } = req.query;

    // Get all pending reports first, then filter in JavaScript
    const allPendingReports = await prisma.report.findMany({
      where: {
        status: 'pending',
      },
      take: parseInt(limit as string) * 2, // Get more to filter
      select: {
        id: true,
        title: true,
        description: true,
        images: true,
        location: true,
        category: true,
        createdAt: true,
        aiScore: true,
      },
      orderBy: {
        createdAt: 'asc', // Process oldest first
      },
    });

    // Filter reports that haven't been processed by AI
    const pendingReports = allPendingReports.filter(report => {
      // No AI score at all
      if (!report.aiScore) return true;
      
      // AI score exists but legit is null/undefined
      const aiScore = report.aiScore as any;
      return aiScore.legit === null || aiScore.legit === undefined;
    }).slice(0, parseInt(limit as string)); // Take only the limit

    return res.status(200).json({
      data: pendingReports,
      count: pendingReports.length,
    });
  } catch (error) {
    console.error('Get pending AI reports error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch pending reports' },
    });
  }
};