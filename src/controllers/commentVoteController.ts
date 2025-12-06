import { Request, Response } from 'express';
import { pool } from '../config/postgres';
import { randomUUID } from 'crypto';
import { calculateVoteChange, isValidVoteValue, type VoteState } from '../utils/voteLogic';

interface CommentVoteRow {
  value: number;
}

/**
 * POST /api/v1/reports/comments/:id/vote
 * Reddit-style voting: click same button = remove vote, click opposite = change vote
 */
export const voteComment = async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { id: commentId } = req.params;
    const { value } = req.body;
    const userId = req.userId!;

    // Validate vote value
    const voteValue = typeof value === 'string' ? parseInt(value) : value;
    if (!isValidVoteValue(voteValue)) {
      return res.status(400).json({ error: 'Invalid vote value. Must be 1 (upvote) or -1 (downvote)' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Get comment and current vote counts (source of truth from comment_votes table)
      const commentResult = await client.query(`
        SELECT 
          c.id,
          COALESCE((SELECT COUNT(*)::INTEGER FROM comment_votes WHERE comment_id = c.id AND value = 1), 0) as upvotes,
          COALESCE((SELECT COUNT(*)::INTEGER FROM comment_votes WHERE comment_id = c.id AND value = -1), 0) as downvotes
        FROM comments c
        WHERE c.id = $1
      `, [commentId]);

      const comment = commentResult.rows[0];
      if (!comment) {
        throw new Error('COMMENT_NOT_FOUND');
      }

      const currentUpvotes = parseInt(comment.upvotes) || 0;
      const currentDownvotes = parseInt(comment.downvotes) || 0;

      // 2. Get user's existing vote
      const voteResult = await client.query(
        'SELECT value FROM comment_votes WHERE comment_id = $1 AND user_id = $2',
        [commentId, userId]
      );
      const existingVote = voteResult.rows[0] as CommentVoteRow | undefined;
      const currentUserVote = (existingVote?.value as 1 | -1 | 0) || 0;

      // 3. Calculate new vote state using shared logic
      const currentState: VoteState = {
        upvotes: currentUpvotes,
        downvotes: currentDownvotes,
        userVote: currentUserVote,
      };

      const voteChange = calculateVoteChange(currentState, voteValue);
      const { newUpvotes, newDownvotes, newUserVote } = voteChange;

      // 4. Update database
      if (newUserVote === 0) {
        // Remove vote
        await client.query(
          'DELETE FROM comment_votes WHERE comment_id = $1 AND user_id = $2',
          [commentId, userId]
        );
      } else {
        // Use UPSERT to handle race conditions: INSERT or UPDATE if exists
        // This prevents duplicate key errors when multiple requests come in simultaneously
        await client.query(
          `INSERT INTO comment_votes (id, comment_id, user_id, value) 
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (comment_id, user_id) 
           DO UPDATE SET value = $4`,
          [randomUUID(), commentId, userId, newUserVote]
        );
      }

      // 5. Update comment with new counts
      await client.query(
        'UPDATE comments SET upvotes = $1, downvotes = $2 WHERE id = $3',
        [newUpvotes, newDownvotes, commentId]
      );

      await client.query('COMMIT');

      // 6. Recalculate vote counts from database (source of truth) to ensure accuracy
      // This prevents flicker by returning the actual database state, not calculated values
      const finalCountResult = await client.query(`
        SELECT 
          COALESCE((SELECT COUNT(*)::INTEGER FROM comment_votes WHERE comment_id = $1 AND value = 1), 0) as upvotes,
          COALESCE((SELECT COUNT(*)::INTEGER FROM comment_votes WHERE comment_id = $1 AND value = -1), 0) as downvotes
      `, [commentId]);

      const finalCounts = finalCountResult.rows[0];
      const finalUpvotes = parseInt(finalCounts.upvotes) || 0;
      const finalDownvotes = parseInt(finalCounts.downvotes) || 0;

      const processingTime = Date.now() - startTime;

      // Return actual database counts, not calculated values
      // This ensures the client receives the authoritative state
      res.json({
        comment_id: commentId,
        upvotes: finalUpvotes,
        downvotes: finalDownvotes,
        user_vote: newUserVote,
        processing_time: processingTime,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error(`❌ Comment vote failed after ${Date.now() - startTime}ms:`, error);
    
    if (error.message === 'COMMENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    res.status(500).json({ error: 'Failed to process comment vote' });
  }
};

/**
 * GET /api/v1/reports/comments/:id/vote
 * Get user's vote on a comment
 */
export const getCommentVote = async (req: Request, res: Response) => {
  try {
    const { id: commentId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(200).json({ user_vote: 0 });
    }

    const result = await pool.query(
      'SELECT value FROM comment_votes WHERE comment_id = $1 AND user_id = $2',
      [commentId, userId]
    );
    const vote = result.rows[0] as CommentVoteRow | undefined;

    return res.status(200).json({
      user_vote: vote?.value || 0,
    });
  } catch (error) {
    console.error('Get comment vote error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch comment vote' },
    });
  }
};
