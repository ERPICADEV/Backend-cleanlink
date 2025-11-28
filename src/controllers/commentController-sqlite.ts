import { Request, Response } from 'express';
import db from '../config/sqlite';
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
    const reportStmt = db.prepare('SELECT id, reporter_id, title FROM reports WHERE id = ?');
    const report: any = reportStmt.get(reportId);

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Check if parent comment exists and belongs to same report (if provided)
    if (parent_comment_id) {
      const parentStmt = db.prepare('SELECT id FROM comments WHERE id = ? AND report_id = ?');
      const parentComment: any = parentStmt.get(parent_comment_id, reportId);

      if (!parentComment) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Parent comment not found for this report' },
        });
      }
    }

    // Basic anti-spam: Check for recent comments from same user
    const recentStmt = db.prepare(`
      SELECT COUNT(*) as count FROM comments 
      WHERE author_id = ? AND created_at >= datetime('now', '-1 minute')
    `);
    const recentResult: any = recentStmt.get(req.userId!);
    const recentComments = recentResult.count;

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
    const insertStmt = db.prepare(`
      INSERT INTO comments (id, report_id, author_id, text, parent_comment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    insertStmt.run(
      commentId,
      reportId,
      req.userId!,
      text.trim(),
      parent_comment_id || null
    );

    // Get created comment with author info
    const commentStmt = db.prepare(`
      SELECT c.*, u.username, u.badges 
      FROM comments c 
      LEFT JOIN users u ON c.author_id = u.id 
      WHERE c.id = ?
    `);
    const comment: any = commentStmt.get(commentId);

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

    // Check if report exists
    const reportStmt = db.prepare('SELECT id FROM reports WHERE id = ?');
    const report: any = reportStmt.get(reportId);

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Get top-level comments (no parent)
    const commentsStmt = db.prepare(`
      SELECT c.*, u.username, u.badges 
      FROM comments c 
      LEFT JOIN users u ON c.author_id = u.id 
      WHERE c.report_id = ? AND c.parent_comment_id IS NULL
      ORDER BY c.created_at ASC
      LIMIT ?
    `);
    const comments = commentsStmt.all(reportId, parseInt(limit as string));

    // Format comments
    const formatComment = (comment: any): any => {
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

      // Get replies if requested
      if (include_replies === 'true') {
        const repliesStmt = db.prepare(`
          SELECT c.*, u.username, u.badges 
          FROM comments c 
          LEFT JOIN users u ON c.author_id = u.id 
          WHERE c.parent_comment_id = ?
          ORDER BY c.created_at ASC
        `);
        const replies = repliesStmt.all(comment.id);
        
        if (replies.length > 0) {
          formatted.replies = replies.map((reply: any) => formatComment(reply));
        }
      }

      return formatted;
    };

    const formattedComments = comments.map((comment: any) => formatComment(comment));

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
    const updateStmt = db.prepare(`
      UPDATE comments 
      SET text = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    updateStmt.run(text.trim(), id);

    // Get updated comment with author info
    const commentStmt = db.prepare(`
      SELECT c.*, u.username, u.badges 
      FROM comments c 
      LEFT JOIN users u ON c.author_id = u.id 
      WHERE c.id = ?
    `);
    const updatedComment: any = commentStmt.get(id);

    if (!updatedComment) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Comment not found' },
      });
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

    const deleteStmt = db.prepare('DELETE FROM comments WHERE id = ?');
    const result: any = deleteStmt.run(id);

    if (result.changes === 0) {
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