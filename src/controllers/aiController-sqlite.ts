import { Request, Response } from 'express';
import db from '../config/sqlite';
import { randomUUID } from 'crypto';

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
    const reportStmt = db.prepare('SELECT id, status FROM reports WHERE id = ?');
    const report: any = reportStmt.get(id);

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Transaction for atomic operations
    db.transaction(() => {
      // Prepare AI score data
      const aiScoreData = {
        legit: ai_score.legit,
        severity: ai_score.severity || 0.5,
        duplicate_prob: duplicate_prob || 0,
        insights: insights || [],
        processed_at: new Date().toISOString(),
      };

      let newStatus = report.status;

      // Handle duplicate detection
      if (duplicate_of) {
        const duplicateStmt = db.prepare('SELECT id FROM reports WHERE id = ?');
        const duplicateReport: any = duplicateStmt.get(duplicate_of);

        if (duplicateReport) {
          newStatus = 'duplicate';
        }
      }

      // Auto-flag reports with low legitimacy score
      if (ai_score.legit < 0.3) {
        newStatus = 'flagged';
      } else if (ai_score.legit > 0.7 && report.status === 'pending') {
        newStatus = 'community_verified';
      }

      // Update the report
      const updateStmt = db.prepare(`
        UPDATE reports 
        SET ai_score = ?, status = ?, duplicate_of = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      updateStmt.run(
        JSON.stringify(aiScoreData),
        newStatus,
        duplicate_of || null,
        id
      );

      // Create audit log
      const auditLogId = randomUUID();
      const auditStmt = db.prepare(`
        INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      auditStmt.run(
        auditLogId,
        null, // System action
        'AI_ANALYSIS_COMPLETE',
        'REPORT',
        id,
        JSON.stringify({
          ai_score: ai_score.legit,
          severity: ai_score.severity,
          duplicate_of: duplicate_of,
          new_status: newStatus,
          insights: insights || [],
        })
      );
    })();

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

    // Get pending reports
    const pendingStmt = db.prepare(`
      SELECT id, title, description, images, location, category, created_at, ai_score
      FROM reports 
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `);
    
    const allPendingReports = pendingStmt.all(parseInt(limit as string) * 2);

    // Filter reports that haven't been processed by AI
    const pendingReports = allPendingReports.filter((report: any) => {
      // No AI score at all
      if (!report.ai_score) return true;
      
      try {
        // AI score exists but legit is null/undefined
        const aiScore = JSON.parse(report.ai_score);
        return aiScore.legit === null || aiScore.legit === undefined;
      } catch {
        // If JSON parsing fails, consider it unprocessed
        return true;
      }
    }).slice(0, parseInt(limit as string));

    // Parse JSON fields for response
    const formattedReports = pendingReports.map((report: any) => ({
      id: report.id,
      title: report.title,
      description: report.description,
      images: report.images ? JSON.parse(report.images) : [],
      location: report.location ? JSON.parse(report.location) : {},
      category: report.category,
      createdAt: report.created_at,
      aiScore: report.ai_score ? JSON.parse(report.ai_score) : null,
    }));

    return res.status(200).json({
      data: formattedReports,
      count: formattedReports.length,
    });
  } catch (error) {
    console.error('Get pending AI reports error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch pending reports' },
    });
  }
};