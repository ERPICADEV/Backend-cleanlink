import { Request, Response } from 'express';
import { pool } from '../config/postgres';
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
    const reportResult = await pool.query('SELECT id, status FROM reports WHERE id = $1', [id]);
    const report = reportResult.rows[0] as any;

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Transaction for atomic operations
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
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
        const duplicateResult = await client.query('SELECT id FROM reports WHERE id = $1', [duplicate_of]);
        if (duplicateResult.rows[0]) {
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
      await client.query(`
        UPDATE reports 
        SET ai_score = $1, status = $2, duplicate_of = $3, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $4
      `, [
        JSON.stringify(aiScoreData),
        newStatus,
        duplicate_of || null,
        id
      ]);

      // Create audit log
      const auditLogId = randomUUID();
      await client.query(`
        INSERT INTO audit_logs (id, actor_id, action_type, target_type, target_id, details, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      `, [
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
      ]);
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

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
    const pendingResult = await pool.query(`
      SELECT id, title, description, images, location, category, created_at, ai_score
      FROM reports 
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT $1
    `, [parseInt(limit as string) * 2]);
    
    const allPendingReports = pendingResult.rows;

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