import { Request, Response } from 'express';
import { pool } from '../config/postgres';
import { randomUUID } from 'crypto';
import { enqueueAIAnalysis } from '../utils/queue';
import { handleDatabaseError } from '../utils/dbErrorHandler';
import { withRetry } from '../utils/databaseRetry';
import { PreSubmissionService } from '../services/preSubmissionService';
import { getCached, invalidatePattern } from '../utils/cache';
import { normalizeImagesToUrls, ensureImageUrl } from '../services/imageUploadService';

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
      whereClause += ` AND LOWER(r.category) = LOWER($${paramIndex})`;
      params.push(category.trim());
      paramIndex++;
    }
    
    if (typeof status === 'string' && status.trim()) {
      whereClause += ` AND LOWER(r.status) = LOWER($${paramIndex})`;
      params.push(status.trim());
      paramIndex++;
    }
    
    if (typeof reporter_id === 'string' && reporter_id.trim()) {
      whereClause += ` AND r.reporter_id = $${paramIndex}`;
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
        r.id, r.title, r.description, r.category, r.images, r.location, r.visibility,
        r.community_score, r.status, r.created_at, 
        r.reporter_id, r.reporter_display, r.ai_score,
        COALESCE(cc.comments_count, 0) as comments_count,
        COALESCE(vv.upvotes, 0) as upvotes,
        COALESCE(vv.downvotes, 0) as downvotes
      FROM reports r
      LEFT JOIN (
        SELECT report_id, COUNT(*)::int as comments_count
        FROM comments
        GROUP BY report_id
      ) cc ON cc.report_id = r.id
      LEFT JOIN (
        SELECT 
          report_id,
          COUNT(*) FILTER (WHERE value = 1)::int as upvotes,
          COUNT(*) FILTER (WHERE value = -1)::int as downvotes
        FROM votes
        GROUP BY report_id
      ) vv ON vv.report_id = r.id
      ${whereClause}
      ${orderBy}
      LIMIT $${paramIndex}
    `;
    
    params.push(parseInt(limit as string));

    // Cache ONLY the public (unauthenticated) response to avoid caching user-specific user_vote.
    // Short TTL by design.
    const isPublicRequest = !req.userId;
    const cacheKey = isPublicRequest
      ? `cache:reports:${category || ''}:${status || ''}:${sort}:${limit}:${reporter_id || ''}`
      : null;

    const buildResponse = async () => {
      const result = await withRetry(
        () => pool.query(sql, params),
        3, // max retries
        1000 // initial delay in ms
      );
      const reports = result.rows;

      // Get user votes for all reports if authenticated (NOT cached)
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
      const maskedReports = await Promise.all(
        reports.map(async (report: any) => {
          const reportData = { ...report };
          
          // Normalize legacy images (stringified arrays / data URIs / legacy objects) to URL arrays
          // IMPORTANT: do not coerce non-array objects to [] before normalization (would wipe legacy data).
          const normalized = await normalizeImagesToUrls(reportData.images);
          reportData.images = normalized;
          try {
            await pool.query('UPDATE reports SET images = $1 WHERE id = $2', [JSON.stringify(normalized), reportData.id]);
          } catch (err) {
            console.warn('⚠️ Failed to persist normalized images for report', reportData.id, (err as any)?.message);
          }
          
          // Normalize location: parse stringified JSON if needed
          if (reportData.location && typeof reportData.location === 'string') {
            try {
              reportData.location = JSON.parse(reportData.location);
            } catch {
              // keep as-is if unparsable
            }
          }

          // Normalize images: if any are data URIs, upload and persist URL
          // Mask coordinates if visibility is masked
          if (reportData.location && reportData.visibility === 'masked') {
            const { lat, lng, ...restLocation } = reportData.location;
            reportData.location = restLocation;
          }

          const aiScore = reportData.ai_score ?? null;
          // Parse ai_score if stored as TEXT
          let parsedAiScore = aiScore;
          if (typeof parsedAiScore === 'string') {
            try {
              parsedAiScore = JSON.parse(parsedAiScore);
            } catch {
              // keep raw
            }
          }
        
          const result = {
            ...reportData,
            aiScore: parsedAiScore, // Convert snake_case to camelCase for frontend
            createdAt: reportData.created_at, // Convert snake_case to camelCase
            description_preview: reportData.description.substring(0, 100) + (reportData.description.length > 100 ? '...' : ''),
            upvotes: parseInt(reportData.upvotes) || 0,
            downvotes: parseInt(reportData.downvotes) || 0,
            user_vote: userVotes[reportData.id] || 0
          };
          
          // Remove the snake_case versions from response
          delete result.ai_score;
          delete result.created_at;
          
          return result;
        })
      );

      return {
        data: maskedReports,
        paging: null // Simplified - remove cursor for now
      };
    };

    const responseBody = cacheKey
      ? await getCached(cacheKey, buildResponse, 10)
      : await buildResponse();

    return res.status(200).json(responseBody);
  } catch (error) {
    const errorResponse = handleDatabaseError(error, 'Failed to fetch reports');
    if (errorResponse.status === 503) {
      console.warn('⚠️  Database connection error in getReports');
      // Additional logging for connection errors
      console.error('Full error object:', {
        code: (error as any)?.code,
        message: (error as any)?.message,
        name: (error as any)?.name,
        errno: (error as any)?.errno,
        syscall: (error as any)?.syscall
      });
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
      client_idempotency_key,
      ai_analysis, // Optional: AI analysis from pre-analysis
      suggested_status // Optional: suggested status from pre-analysis
    } = req.body;

    const reporterId = anonymous ? null : req.userId;
    const reporterDisplay = anonymous ? 'Anonymous' : (req as any).userEmail || 'User';
    const reportId = randomUUID();

    // NOTE: In some deployments `reports.images` / `reports.location` are TEXT (see `schema.sql`).
    // Store JSON strings to avoid Postgres array-literal serialization like "{...}" which breaks parsing on read.
    const normalizedImages = await normalizeImagesToUrls(images || []);
    const locationValue = location || {};

    // Determine initial status based on AI analysis if provided
    let initialStatus = 'pending';
    if (ai_analysis && typeof ai_analysis.legit === 'number') {
      // Use the same logic as AI worker: legit < 0.3 = flagged, >= 0.7 = community_verified
      const legit = ai_analysis.legit;
      if (legit < 0.3) {
        initialStatus = 'flagged';
        console.log(`🚩 Setting report status to 'flagged' immediately (legit: ${legit})`);
      } else if (legit >= 0.7) {
        initialStatus = 'community_verified';
        console.log(`✅ Setting report status to 'community_verified' immediately (legit: ${legit})`);
      }
    } else if (suggested_status) {
      // Use suggested status if provided
      initialStatus = suggested_status;
      console.log(`📊 Using suggested status: ${suggested_status}`);
    }

    // Prepare AI score data if provided
    let aiScoreData = null;
    if (ai_analysis) {
      aiScoreData = {
        legit: ai_analysis.legit,
        severity: ai_analysis.severity || 0.5,
        duplicate_prob: ai_analysis.duplicate_prob || 0,
        confidence_label: ai_analysis.confidence_label || 'medium',
        explanation: ai_analysis.explanation,
        vision_insights: ai_analysis.vision_insights || null,
        insights: ai_analysis.insights || [],
        processed_at: new Date().toISOString(),
      };
    }

    await pool.query(`
      INSERT INTO reports (
        id, title, description, category, images, location, visibility,
        reporter_id, reporter_display, community_score, status, ai_score, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
    `, [
      reportId,
      title.trim(),
      description.trim(),
      category,
      JSON.stringify(normalizedImages),
      JSON.stringify(locationValue),
      locationValue?.visibility || 'public',
      reporterId,
      reporterDisplay,
      0, // community_score
      initialStatus, // Use determined status
      aiScoreData ? JSON.stringify(aiScoreData) : null // Store AI analysis if provided
    ]);

    // Only queue AI analysis if we don't already have it
    if (!aiScoreData) {
      try {
        await enqueueAIAnalysis(reportId);
        console.log('📥 Queued AI analysis for report:', reportId);
      } catch (aiError) {
        console.error('❌ Failed to enqueue AI analysis:', aiError);
      }
    } else {
      console.log('✅ Report created with pre-analyzed AI data, skipping queue');
    }

    // Invalidate cached public reads (short TTL, fail-open)
    invalidatePattern('cache:reports:*');
    invalidatePattern(`cache:report:${reportId}`);

    return res.status(201).json({
      id: reportId,
      status: initialStatus, // Return the actual status set
      ai_check: aiScoreData ? 'completed' : 'queued',
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

    // Cache ONLY the public (unauthenticated) response.
    // This endpoint includes user-specific votes and admin-specific fields when authenticated.
    const isPublicRequest = !req.userId;
    const cacheKey = isPublicRequest ? `cache:report:${id}` : null;
    
    // Check if user is admin (simplified)
    let isAdmin = false;
    if (req.userId) {
      const adminResult = await pool.query('SELECT 1 FROM admins WHERE user_id = $1', [req.userId]);
      isAdmin = !!adminResult.rows[0];
    }
    
    const buildReportResponse = async () => {
      // Get report with dynamically calculated vote counts
      const reportResult = await pool.query(`
        SELECT 
          r.*,
          (SELECT COUNT(*) FROM votes WHERE report_id = r.id AND value = 1) as upvotes,
          (SELECT COUNT(*) FROM votes WHERE report_id = r.id AND value = -1) as downvotes
        FROM reports r
        WHERE r.id = $1
      `, [id]);
      const report: any = reportResult.rows[0];

      if (!report) {
        return { __notFound: true as const };
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

      // Fetch the entire comment tree in ONE query (WITH RECURSIVE), including:
      // - author info
      // - upvotes / downvotes counts
      // - current user's vote (if authenticated)
      //
      // Note: Node.js only builds the tree in memory to preserve the existing response shape.
      const commentsResult = await pool.query(
        `
        WITH RECURSIVE comment_tree AS (
          -- Base: top-level comments for this report
          SELECT
            c.id,
            c.report_id,
            c.author_id,
            c.text,
            c.parent_comment_id,
            c.created_at,
            c.updated_at,
            u.username,
            u.badges,
            COALESCE(cv_counts.upvotes, 0) AS upvotes,
            COALESCE(cv_counts.downvotes, 0) AS downvotes,
            COALESCE(uv.value, 0) AS user_vote,
            0 AS depth,
            (to_char(c.created_at, 'YYYYMMDDHH24MISS.MS') || '-' || c.id) AS path
          FROM comments c
          LEFT JOIN users u ON c.author_id = u.id
          LEFT JOIN (
            SELECT
              comment_id,
              COUNT(*) FILTER (WHERE value = 1)::int AS upvotes,
              COUNT(*) FILTER (WHERE value = -1)::int AS downvotes
            FROM comment_votes
            GROUP BY comment_id
          ) cv_counts ON cv_counts.comment_id = c.id
          LEFT JOIN comment_votes uv
            ON uv.comment_id = c.id
           AND uv.user_id = $2
          WHERE c.report_id = $1
            AND c.parent_comment_id IS NULL

          UNION ALL

          -- Recursive: replies
          SELECT
            c.id,
            c.report_id,
            c.author_id,
            c.text,
            c.parent_comment_id,
            c.created_at,
            c.updated_at,
            u.username,
            u.badges,
            COALESCE(cv_counts.upvotes, 0) AS upvotes,
            COALESCE(cv_counts.downvotes, 0) AS downvotes,
            COALESCE(uv.value, 0) AS user_vote,
            ct.depth + 1 AS depth,
            (ct.path || '/' || (to_char(c.created_at, 'YYYYMMDDHH24MISS.MS') || '-' || c.id)) AS path
          FROM comments c
          INNER JOIN comment_tree ct ON c.parent_comment_id = ct.id
          LEFT JOIN users u ON c.author_id = u.id
          LEFT JOIN (
            SELECT
              comment_id,
              COUNT(*) FILTER (WHERE value = 1)::int AS upvotes,
              COUNT(*) FILTER (WHERE value = -1)::int AS downvotes
            FROM comment_votes
            GROUP BY comment_id
          ) cv_counts ON cv_counts.comment_id = c.id
          LEFT JOIN comment_votes uv
            ON uv.comment_id = c.id
           AND uv.user_id = $2
        )
        SELECT
          id,
          author_id,
          text,
          parent_comment_id,
          created_at,
          updated_at,
          username,
          badges,
          upvotes,
          downvotes,
          user_vote
        FROM comment_tree
        ORDER BY path ASC;
        `,
        [id, req.userId || null]
      );

      const flatComments = commentsResult.rows as any[];

      // Build the comment tree in memory while preserving existing JSON shape
      const byId = new Map<string, any>();
      const roots: any[] = [];

      for (const row of flatComments) {
      const formatted: any = {
          id: row.id,
          text: row.text,
          author: {
            id: row.author_id,
            username: row.username || 'Anonymous',
          badges: row.badges || [],
          },
          parent_comment_id: row.parent_comment_id,
          upvotes: parseInt(row.upvotes) || 0,
          downvotes: parseInt(row.downvotes) || 0,
          user_vote: parseInt(row.user_vote) || 0,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };

        byId.set(formatted.id, formatted);

        if (!formatted.parent_comment_id) {
          roots.push(formatted);
        } else {
          const parent = byId.get(formatted.parent_comment_id);
          if (parent) {
            if (!parent.replies) parent.replies = [];
            parent.replies.push(formatted);
          } else {
            // In case ordering ever changes unexpectedly, keep it safe:
            // treat as root rather than dropping the comment.
            roots.push(formatted);
          }
        }
      }

      const comments = roots;

      // Get votes count
      const votesResult = await pool.query('SELECT COUNT(*) as count FROM votes WHERE report_id = $1', [id]);
      const votesCount: any = votesResult.rows[0];

      // Get user's vote if authenticated
      let userVote = 0;
      if (req.userId) {
        const userVoteResult = await pool.query('SELECT value FROM votes WHERE report_id = $1 AND user_id = $2', [id, req.userId]);
        userVote = userVoteResult.rows[0]?.value || 0;
      }

      const aiScore = report.ai_score ?? null;
      let parsedAiScore = aiScore;
      if (typeof parsedAiScore === 'string') {
        try {
          parsedAiScore = JSON.parse(parsedAiScore);
        } catch {
          // keep raw
        }
      }

      // Normalize legacy images (data URIs / stringified arrays / legacy objects) to URLs; persist best-effort
      const normalizedImages = await normalizeImagesToUrls(report.images);
      report.images = normalizedImages;
      try {
        await pool.query('UPDATE reports SET images = $1 WHERE id = $2', [JSON.stringify(normalizedImages), report.id]);
      } catch (err) {
        console.warn('⚠️ Failed to persist normalized images for report', report.id, (err as any)?.message);
      }

      // Normalize location: parse stringified JSON if needed
      if (report.location && typeof report.location === 'string') {
        try {
          report.location = JSON.parse(report.location);
        } catch {
          // keep as-is if unparsable
        }
      }

      const responseReport: any = {
        ...report,
        images: report.images || [],
        location: report.location || {},
        aiScore: parsedAiScore, // Convert snake_case to camelCase for frontend
        createdAt: report.created_at, // Convert snake_case to camelCase
        updatedAt: report.updated_at, // Convert snake_case to camelCase
        upvotes: parseInt(report.upvotes) || 0,
        downvotes: parseInt(report.downvotes) || 0,
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
        const resolutionPhotos: string[] = latestProgress.photos || [];

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

      return responseReport;
    };

    const built = cacheKey ? await getCached(cacheKey, buildReportResponse, 15) : await buildReportResponse();

    if ((built as any)?.__notFound) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    return res.status(200).json(built);
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
        updateParams.push(updates[key]);
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

    // Invalidate cached public reads (short TTL, fail-open)
    invalidatePattern('cache:reports:*');
    invalidatePattern(`cache:report:${id}`);

    // Get updated report
    const updatedReportResult = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
    const updatedReport = updatedReportResult.rows[0] as any;

    // Normalize images on update
    if (Array.isArray(updatedReport.images)) {
      const normalized = await normalizeImagesToUrls(updatedReport.images);
      updatedReport.images = normalized;
      try {
        await pool.query('UPDATE reports SET images = $1 WHERE id = $2', [normalized, id]);
      } catch (err) {
        console.warn('⚠️ Failed to persist normalized images for report', id, (err as any)?.message);
      }
    }

    return res.status(200).json(updatedReport);
  } catch (error) {
    console.error('Update report error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update report' },
    });
  }
};

// POST /api/v1/reports/pre-submission-suggestions
export const getPreSubmissionSuggestions = async (req: Request, res: Response) => {
  try {
    const { title, description, category, images } = req.body;

    // Validate required fields
    if (!title || !description || !category) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Title, description, and category are required' },
      });
    }

    const apiKey = process.env.OPENROUTER_API_KEY || '';
    const service = new PreSubmissionService(apiKey);

    const suggestions = await service.getSuggestions({
      title: title.trim(),
      description: description.trim(),
      category: category.toLowerCase(),
      imageCount: Array.isArray(images) ? images.length : (images ? 1 : 0),
    });

    return res.status(200).json(suggestions);
  } catch (error) {
    console.error('Pre-submission suggestions error:', error);
    // Return empty suggestions on error (non-blocking)
    return res.status(200).json({ suggestions: [] });
  }
};

function calculateCommunityScore(upvotes: number, downvotes: number): number {
  const total = upvotes + downvotes;
  if (total === 0) return 0;
  return (upvotes - downvotes) / total;
}