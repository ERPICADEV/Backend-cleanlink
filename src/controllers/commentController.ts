import { Request, Response } from 'express';
import prisma from '../config/database';

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

    // Check if report exists
    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Check if parent comment exists and belongs to same report (if provided)
    if (parent_comment_id) {
      const parentComment = await prisma.comment.findFirst({
        where: { 
          id: parent_comment_id,
          reportId: reportId 
        },
      });

      if (!parentComment) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'Parent comment not found for this report' },
        });
      }
    }

    // Basic anti-spam: Check for recent comments from same user
    const recentComments = await prisma.comment.count({
      where: {
        authorId: req.userId!,
        createdAt: {
          gte: new Date(Date.now() - 60 * 1000), // Last 1 minute
        },
      },
    });

    if (recentComments >= 5) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT',
          message: 'Too many comments. Please wait before commenting again.',
        },
      });
    }

    const comment = await prisma.comment.create({
      data: {
        reportId: reportId,
        authorId: req.userId!,
        text: text.trim(),
        parentCommentId: parent_comment_id || null,
      },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            badges: true,
          },
        },
      },
    });

    return res.status(201).json({
      id: comment.id,
      text: comment.text,
      author: {
        id: comment.author?.id,
        username: comment.author?.username || 'Anonymous',
        badges: comment.author?.badges || [],
      },
      parent_comment_id: comment.parentCommentId,
      created_at: comment.createdAt,
      updated_at: comment.updatedAt,
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
    const { limit = 20, cursor, include_replies = 'true' } = req.query;

    // Check if report exists
    const report = await prisma.report.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Get top-level comments (no parent)
    const comments = await prisma.comment.findMany({
      where: { 
        reportId: reportId,
        parentCommentId: null
      },
      take: parseInt(limit as string) + 1,
      cursor: cursor ? { id: cursor as string } : undefined,
      orderBy: { createdAt: 'asc' },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            badges: true,
          },
        },
        // Include replies if requested
        replies: include_replies === 'true' ? {
          include: {
            author: {
              select: {
                id: true,
                username: true,
                badges: true,
              },
            },
            // You can nest replies further if needed, but be careful of depth
            replies: include_replies === 'true' ? {
              include: {
                author: {
                  select: {
                    id: true,
                    username: true,
                    badges: true,
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            } : false,
          },
          orderBy: { createdAt: 'asc' },
        } : false,
      },
    });

    let nextCursor = undefined;
    if (comments.length > parseInt(limit as string)) {
      nextCursor = comments[comments.length - 1].id;
      comments.pop();
    }

    // Helper function to format comments recursively
    const formatComment = (comment: any): any => {
      const formatted: any = {
        id: comment.id,
        text: comment.text,
        author: {
          id: comment.author?.id,
          username: comment.author?.username || 'Anonymous',
          badges: comment.author?.badges || [],
        },
        parent_comment_id: comment.parentCommentId,
        created_at: comment.createdAt,
        updated_at: comment.updatedAt,
      };

      // Add replies if they exist and include_replies is true
      if (include_replies === 'true' && comment.replies && comment.replies.length > 0) {
        formatted.replies = comment.replies.map((reply: any) => formatComment(reply));
      }

      return formatted;
    };

    const formattedComments = comments.map(comment => formatComment(comment));

    return res.status(200).json({
      data: formattedComments,
      paging: nextCursor ? { next_cursor: nextCursor } : null,
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

    const updatedComment = await prisma.comment.update({
      where: { id },
      data: { text: text.trim() },
      include: {
        author: {
          select: {
            id: true,
            username: true,
            badges: true,
          },
        },
      },
    });

    return res.status(200).json({
      id: updatedComment.id,
      text: updatedComment.text,
      author: {
        id: updatedComment.author?.id,
        username: updatedComment.author?.username || 'Anonymous',
        badges: updatedComment.author?.badges || [],
      },
      parent_comment_id: updatedComment.parentCommentId,
      created_at: updatedComment.createdAt,
      updated_at: updatedComment.updatedAt,
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

    await prisma.comment.delete({
      where: { id },
    });

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