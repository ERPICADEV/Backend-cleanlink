import { Request, Response } from 'express';
import { pool } from '../config/postgres';
import { randomUUID } from 'crypto';
import { enqueueAIAnalysis } from '../utils/queue';
import { handleDatabaseError } from '../utils/dbErrorHandler';
import { withRetry } from '../utils/databaseRetry';

// GET /api/v1/reports (feed)
export const getReports = async (req: Request, res: Response) => {
  try {
    const { 
      category, 
      status, 
      sort = 'new', 
      limit = 20,
      reporter_id
    } = req.query;

    // Build WHERE clause
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;
    
    if (typeof category === 'string' && category.trim()) {
      whereClause += ` AND LOWER(category) = LOWER($${paramIndex})`;
      params.push(category.trim());
      paramIndex++;
    }
    
    if (typeof status === 'string' && status.trim()) {
      whereClause += ` AND LOWER(status) = LOWER($${paramIndex})`;
      params.push(status.trim());
      paramIndex++;
    }
    
    if (typeof reporter_id === 'string' && reporter_id.trim()) {
      whereClause += ` AND reporter_id = $${paramIndex}`;
      params.push(reporter_id.trim());
      paramIndex++;
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
        reporter_id, reporter_display, ai_score,
        (SELECT COUNT(*) FROM comments WHERE report_id = reports.id) as comments_count
      FROM reports 
      ${whereClause}
      ${orderBy}
      LIMIT $${paramIndex}
    `;
    
    params.push(parseInt(limit as string));
    
    // Use retry logic for database queries to handle transient connection issues
    const result = await withRetry(
      () => pool.query(sql, params),
      3, // max retries
      1000 // initial delay in ms
    );
    const reports = result.rows;

    // Get user votes for all reports if authenticated
    let userVotes: Record<string, number> = {};
    if (req.userId) {
      const reportIds = reports.map((r: any) => r.id);
      if (reportIds.length > 0) {
        const placeholders = reportIds.map((_, i) => `$${i + 1}`).join(',');
        const userVoteResult = await withRetry(
          () => pool.query(`
            SELECT report_id, value FROM votes 
            WHERE report_id IN (${placeholders}) AND user_id = $${reportIds.length + 1}
          `, [...reportIds, req.userId]),
          3,
          1000
        );
        userVoteResult.rows.forEach((vote: any) => {
          userVotes[vote.report_id] = vote.value;
        });
      }
    }

    // Mask coordinates for public feed
    const maskedReports = reports.map((report: any) => {
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
      
      // Parse ai_score and convert to camelCase
      let aiScore = null;
      try {
        if (reportData.ai_score) {
          aiScore = JSON.parse(reportData.ai_score);
        }
      } catch (e) {
        console.error('Error parsing ai_score:', e);
      }
      
      const result = {
        ...reportData,
        aiScore, // Convert snake_case to camelCase for frontend
        createdAt: reportData.created_at, // Convert snake_case to camelCase
        description_preview: reportData.description.substring(0, 100) + (reportData.description.length > 100 ? '...' : ''),
        user_vote: userVotes[reportData.id] || 0
      };
      
      // Remove the snake_case versions from response
      delete result.ai_score;
      delete result.created_at;
      
      return result;
    });

    return res.status(200).json({
      data: maskedReports,
      paging: null // Simplified - remove cursor for now
    });
  } catch (error) {
    const errorResponse = handleDatabaseError(error, 'Failed to fetch reports');
    if (errorResponse.status === 503) {
      console.warn('⚠️  Database connection error in getReports');
    } else {
      console.error('Get reports error:', error);
    }
    res.status(errorResponse.status).json(errorResponse.error);
  }
};

// POST /api/v1/reports
export const createReport = async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      category,
      images,
      location,
      anonymous = false,
      client_idempotency_key
    } = req.body;

    const reporterId = anonymous ? null : req.userId;
    const reporterDisplay = anonymous ? 'Anonymous' : (req as any).userEmail || 'User';
    const reportId = randomUUID();

    await pool.query(`
      INSERT INTO reports (
        id, title, description, category, images, location, visibility,
        reporter_id, reporter_display, community_score, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
    `, [
      reportId,
      title.trim(),
      description.trim(),
      category,
      JSON.stringify(images || []),
      JSON.stringify(location || {}),
      location?.visibility || 'public',
      reporterId,
      reporterDisplay,
      0, // community_score
      'pending' // status
    ]);

    try {
      await enqueueAIAnalysis(reportId);
    } catch (aiError) {
      console.error('❌ Failed to enqueue AI analysis:', aiError);
    }

    return res.status(201).json({
      id: reportId,
      status: 'pending',
      ai_check: 'queued',
      created_at: new Date().toISOString(),
      points_awarded: 0
    });
  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create report' },
    });
  }
};

// GET /api/v1/reports/:id
export const getReport = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Check if user is admin (simplified)
    let isAdmin = false;
    if (req.userId) {
      const adminResult = await pool.query('SELECT 1 FROM admins WHERE user_id = $1', [req.userId]);
      isAdmin = !!adminResult.rows[0];
    }
    
    // Get report
    const reportResult = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
    const report: any = reportResult.rows[0];

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Get reporter info
    let reporter = null;
    if (report.reporter_id) {
      const reporterResult = await pool.query(`
        SELECT id, username, ${isAdmin ? 'email,' : ''} badges 
        FROM users WHERE id = $1
      `, [report.reporter_id]);
      reporter = reporterResult.rows[0];
    }

    // Get comments with authors
    const commentsResult = await pool.query(`
      SELECT c.*, u.username, u.badges 
      FROM comments c 
      LEFT JOIN users u ON c.author_id = u.id 
      WHERE c.report_id = $1 
      ORDER BY c.created_at ASC
    `, [id]);
    const rawComments = commentsResult.rows as any[];

    // Format comments to match getComments endpoint structure
    const formatComment = async (comment: any): Promise<any> => {
      const formatted: any = {
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
      const repliesResult = await pool.query(`
        SELECT c.*, u.username, u.badges 
        FROM comments c 
        LEFT JOIN users u ON c.author_id = u.id 
        WHERE c.parent_comment_id = $1
        ORDER BY c.created_at ASC
      `, [comment.id]);
      const replies = repliesResult.rows as any[];
      
      if (replies.length > 0) {
        formatted.replies = await Promise.all(replies.map((reply: any) => formatComment(reply)));
      }

      return formatted;
    };

    // Get top-level comments (no parent) and format them
    const topLevelComments = rawComments.filter((c: any) => !c.parent_comment_id);
    const comments = await Promise.all(topLevelComments.map((comment: any) => formatComment(comment)));

    // Get votes count
    const votesResult = await pool.query('SELECT COUNT(*) as count FROM votes WHERE report_id = $1', [id]);
    const votesCount: any = votesResult.rows[0];

    // Get user's vote if authenticated
    let userVote = 0;
    if (req.userId) {
      const userVoteResult = await pool.query('SELECT value FROM votes WHERE report_id = $1 AND user_id = $2', [id, req.userId]);
      userVote = userVoteResult.rows[0]?.value || 0;
    }

    // Parse JSON fields
    let aiScore = null;
    try {
      if (report.ai_score) {
        aiScore = JSON.parse(report.ai_score);
      }
    } catch (e) {
      console.error('Error parsing ai_score:', e);
    }

    const responseReport: any = {
      ...report,
      images: report.images ? JSON.parse(report.images) : [],
      location: report.location ? JSON.parse(report.location) : {},
      aiScore, // Convert snake_case to camelCase for frontend
      createdAt: report.created_at, // Convert snake_case to camelCase
      updatedAt: report.updated_at, // Convert snake_case to camelCase
      reporter,
      comments,
      user_vote: userVote,
      _count: {
        votes: votesCount.count
      }
    };

    // Remove the snake_case versions from response
    delete responseReport.ai_score;
    delete responseReport.created_at;
    delete responseReport.updated_at;

    // If the report has been worked on by admins, expose the latest
    // resolution photos/details so they can be shown in the public feed.
    const resolutionResult = await pool.query(`
      SELECT photos, completion_details, submitted_at
      FROM report_progress
      WHERE report_id = $1
      ORDER BY submitted_at DESC
      LIMIT 1
    `, [id]);
    const latestProgress = resolutionResult.rows[0] as any | undefined;

    if (latestProgress) {
      let resolutionPhotos: string[] = [];
      try {
        if (latestProgress.photos) {
          resolutionPhotos = JSON.parse(latestProgress.photos);
        }
      } catch (e) {
        console.error('Error parsing resolution photos:', e);
      }

      responseReport.resolutionPhotos = resolutionPhotos;
      responseReport.resolutionDetails = latestProgress.completion_details || null;
    }

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
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch report' },
    });
  }
};

// PATCH /api/v1/reports/:id
export const updateReport = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Check if user is admin
    let isAdmin = false;
    if (req.userId) {
      const adminResult = await pool.query('SELECT 1 FROM admins WHERE user_id = $1', [req.userId]);
      isAdmin = !!adminResult.rows[0];
    }

    // Get existing report
    const getResult = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
    const existingReport = getResult.rows[0] as any;

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
    const updateFields: string[] = [];
    const updateParams: any[] = [];
    let paramIndex = 1;
    
    Object.keys(updates).forEach(key => {
      if (key === 'images' || key === 'location') {
        updateFields.push(`${key} = $${paramIndex}`);
        updateParams.push(JSON.stringify(updates[key]));
      } else {
        updateFields.push(`${key} = $${paramIndex}`);
        updateParams.push(updates[key]);
      }
      paramIndex++;
    });
    
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    
    const updateSql = `UPDATE reports SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`;
    updateParams.push(id);
    
    await pool.query(updateSql, updateParams);

    // Get updated report
    const updatedReportResult = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
    const updatedReport = updatedReportResult.rows[0] as any;

    // Parse JSON fields
    if (updatedReport.images) {
      updatedReport.images = JSON.parse(updatedReport.images);
    }
    if (updatedReport.location) {
      updatedReport.location = JSON.parse(updatedReport.location);
    }

    return res.status(200).json(updatedReport);
  } catch (error) {
    console.error('Update report error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update report' },
    });
  }
};

function calculateCommunityScore(upvotes: number, downvotes: number): number {
  const total = upvotes + downvotes;
  if (total === 0) return 0;
  return (upvotes - downvotes) / total;
}