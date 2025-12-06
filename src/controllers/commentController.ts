import { Request, Response } from 'express';
import { pool } from '../config/postgres';
import { randomUUID } from 'crypto';
import { NotificationService } from '../services/notificationService';

// POST /api/v1/reports/:id/comments
export const createComment = async (req: Request, res: Response) => {
  try {
    const { id: reportId } = req.params;
    const { text, parent_comment_id } = req.body;

    // Validations
    if (!text || text.trim().length === 0 || text.length > 1000) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Comment text required and must be ≤ 1000 chars',
          fields: { text: 'Invalid comment text' },
        },
      });
    }

    // Check if report exists and get owner
    const reportResult = await pool.query('SELECT id, reporter_id, title FROM reports WHERE id = $1', [reportId]);
    const report: any = reportResult.rows[0];

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Check if parent comment exists and belongs to same report (if provided)
    if (parent_comment_id) {
      const parentResult = await pool.query('SELECT id FROM comments WHERE id = $1 AND report_id = $2', [parent_comment_id, reportId]);
      const parentComment = parentResult.rows[0];

      if (!parentComment) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Parent comment not found for this report' },
        });
      }
    }

    // Basic anti-spam: Check for recent comments from same user
    const recentResult = await pool.query(`
      SELECT COUNT(*) as count FROM comments 
      WHERE author_id = $1 AND created_at >= NOW() - INTERVAL '1 minute'
    `, [req.userId!]);
    const recentComments = parseInt(recentResult.rows[0].count);

    if (recentComments >= 5) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT',
          message: 'Too many comments. Please wait before commenting again.',
        },
      });
    }

    // Create comment
    const commentId = randomUUID();
    // Use UTC timestamp to avoid timezone issues
    const now = new Date().toISOString();
    await pool.query(`
      INSERT INTO comments (id, report_id, author_id, text, parent_comment_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      commentId,
      reportId,
      req.userId!,
      text.trim(),
      parent_comment_id || null,
      now,
      now
    ]);

    // Get created comment with author info
    const commentResult = await pool.query(`
      SELECT c.*, u.username, u.badges 
      FROM comments c 
      LEFT JOIN users u ON c.author_id = u.id 
      WHERE c.id = $1
    `, [commentId]);
    const comment: any = commentResult.rows[0];

    // Fire-and-forget notification to report owner (if not self-comment)
    if (report.reporter_id && report.reporter_id !== req.userId) {
      const snippet =
        comment.text && comment.text.length > 80
          ? `${comment.text.slice(0, 77)}...`
          : comment.text;

      NotificationService.notifyNewComment(
        report.reporter_id,
        reportId,
        comment.username,
        snippet
      );
    }

    return res.status(201).json({
      id: comment.id,
      text: comment.text,
      author: {
        id: comment.author_id,
        username: comment.username || 'Anonymous',
        badges: comment.badges ? JSON.parse(comment.badges) : [],
      },
      parent_comment_id: comment.parent_comment_id,
      upvotes: comment.upvotes || 0,
      downvotes: comment.downvotes || 0,
      user_vote: 0,
      created_at: comment.created_at,
      updated_at: comment.updated_at,
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create comment' },
    });
  }
};

// GET /api/v1/reports/:id/comments
export const getComments = async (req: Request, res: Response) => {
  try {
    const { id: reportId } = req.params;
    const { limit = 20, include_replies = 'true' } = req.query;
    const userId = req.userId || null; // Optional user ID for vote status

    // Check if report exists
    const reportResult = await pool.query('SELECT id FROM reports WHERE id = $1', [reportId]);
    const report = reportResult.rows[0];

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Get top-level comments (no parent) with dynamically calculated vote counts
    const commentsResult = await pool.query(`
      SELECT 
        c.*, 
        u.username, 
        u.badges,
        (SELECT COUNT(*) FROM comment_votes WHERE comment_id = c.id AND value = 1) as upvotes,
        (SELECT COUNT(*) FROM comment_votes WHERE comment_id = c.id AND value = -1) as downvotes
      FROM comments c 
      LEFT JOIN users u ON c.author_id = u.id 
      WHERE c.report_id = $1 AND c.parent_comment_id IS NULL
      ORDER BY c.created_at ASC
      LIMIT $2
    `, [reportId, parseInt(limit as string)]);
    const comments = commentsResult.rows;

    // Format comments
    const formatComment = async (comment: any): Promise<any> => {
      // Get user's vote for this comment if authenticated
      let userVote = 0;
      if (userId) {
        const voteResult = await pool.query('SELECT value FROM comment_votes WHERE comment_id = $1 AND user_id = $2', [comment.id, userId]);
        userVote = voteResult.rows[0]?.value || 0;
      }

      const formatted: any = {
        id: comment.id,
        text: comment.text,
        author: {
          id: comment.author_id,
          username: comment.username || 'Anonymous',
          badges: comment.badges ? JSON.parse(comment.badges) : [],
        },
        parent_comment_id: comment.parent_comment_id,
        upvotes: parseInt(comment.upvotes) || 0,
        downvotes: parseInt(comment.downvotes) || 0,
        user_vote: userVote,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
      };

      // Get replies if requested with dynamically calculated vote counts
      if (include_replies === 'true') {
        const repliesResult = await pool.query(`
          SELECT 
            c.*, 
            u.username, 
            u.badges,
            (SELECT COUNT(*) FROM comment_votes WHERE comment_id = c.id AND value = 1) as upvotes,
            (SELECT COUNT(*) FROM comment_votes WHERE comment_id = c.id AND value = -1) as downvotes
          FROM comments c 
          LEFT JOIN users u ON c.author_id = u.id 
          WHERE c.parent_comment_id = $1
          ORDER BY c.created_at ASC
        `, [comment.id]);
        const replies = repliesResult.rows;
        
        if (replies.length > 0) {
          formatted.replies = await Promise.all(replies.map((reply: any) => formatComment(reply)));
        }
      }

      return formatted;
    };

    const formattedComments = await Promise.all(comments.map((comment: any) => formatComment(comment)));

    return res.status(200).json({
      data: formattedComments,
      paging: null, // Simplified pagination
    });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch comments' },
    });
  }
};

// PATCH /api/v1/comments/:id
export const updateComment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    // Validations
    if (!text || text.trim().length === 0 || text.length > 1000) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Comment text required and must be ≤ 1000 chars',
          fields: { text: 'Invalid comment text' },
        },
      });
    }

    // Update comment
    await pool.query(`
      UPDATE comments 
      SET text = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $2
    `, [text.trim(), id]);

    // Get updated comment with author info
    const commentResult = await pool.query(`
      SELECT c.*, u.username, u.badges 
      FROM comments c 
      LEFT JOIN users u ON c.author_id = u.id 
      WHERE c.id = $1
    `, [id]);
    const updatedComment: any = commentResult.rows[0];

    if (!updatedComment) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Comment not found' },
      });
    }

    // Get user's vote for this comment if authenticated
    let userVote = 0;
    if (req.userId) {
      const voteResult = await pool.query('SELECT value FROM comment_votes WHERE comment_id = $1 AND user_id = $2', [id, req.userId]);
      userVote = voteResult.rows[0]?.value || 0;
    }

    return res.status(200).json({
      id: updatedComment.id,
      text: updatedComment.text,
      author: {
        id: updatedComment.author_id,
        username: updatedComment.username || 'Anonymous',
        badges: updatedComment.badges ? JSON.parse(updatedComment.badges) : [],
      },
      parent_comment_id: updatedComment.parent_comment_id,
      upvotes: updatedComment.upvotes || 0,
      downvotes: updatedComment.downvotes || 0,
      user_vote: userVote,
      created_at: updatedComment.created_at,
      updated_at: updatedComment.updated_at,
    });
  } catch (error) {
    console.error('Update comment error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update comment' },
    });
  }
};

// DELETE /api/v1/comments/:id
export const deleteComment = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query('DELETE FROM comments WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Comment not found' },
      });
    }

    return res.status(200).json({
      message: 'Comment deleted successfully',
    });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to delete comment' },
    });
  }
};