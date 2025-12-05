import { Request, Response } from 'express';
import db from '../config/sqlite';
import { randomUUID } from 'crypto';

// Define types
interface CommentRow {
  upvotes: number;
  downvotes: number;
  author_id?: string | null;
}

interface CommentVoteRow {
  value: number;
}

// POST /api/v1/comments/:id/vote
export const voteComment = async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { id: commentId } = req.params;
    const { value } = req.body;
    const userId = req.userId!;

    const voteValue = typeof value === 'string' ? parseInt(value) : value;

    if (voteValue !== 1 && voteValue !== -1) {
      return res.status(400).json({ error: 'Invalid vote value' });
    }

    // Prepare statements
    const getCommentStmt = db.prepare('SELECT upvotes, downvotes, author_id FROM comments WHERE id = ?');
    const getVoteStmt = db.prepare('SELECT value FROM comment_votes WHERE comment_id = ? AND user_id = ?');
    const deleteVoteStmt = db.prepare('DELETE FROM comment_votes WHERE comment_id = ? AND user_id = ?');
    const updateVoteStmt = db.prepare('UPDATE comment_votes SET value = ? WHERE comment_id = ? AND user_id = ?');
    const insertVoteStmt = db.prepare('INSERT INTO comment_votes (id, comment_id, user_id, value) VALUES (?, ?, ?, ?)');
    const updateCommentStmt = db.prepare('UPDATE comments SET upvotes = ?, downvotes = ? WHERE id = ?');

    // Transaction for atomic operations
    let finalUserVote = voteValue;

    db.transaction(() => {
      // 1. Get comment
      const comment = getCommentStmt.get(commentId) as CommentRow | undefined;
      if (!comment) {
        throw new Error('COMMENT_NOT_FOUND');
      }

      const { upvotes, downvotes } = comment;

      // 2. Check existing vote
      const existingVote = getVoteStmt.get(commentId, userId) as CommentVoteRow | undefined;
      
      let userVote = voteValue;
      let newUpvotes = upvotes;
      let newDownvotes = downvotes;

      // 3. Handle vote logic
      if (existingVote) {
        if (existingVote.value === voteValue) {
          // User clicked the same vote button - toggle off (remove vote, set to 0)
          deleteVoteStmt.run(commentId, userId);
          // Remove the vote from counts
          if (voteValue === 1) {
            newUpvotes = Math.max(0, upvotes - 1);
            newDownvotes = downvotes;
          } else {
            newUpvotes = upvotes;
            newDownvotes = Math.max(0, downvotes - 1);
          }
          userVote = 0;
        } else {
          // Change vote
          updateVoteStmt.run(voteValue, commentId, userId);
          // Remove old vote from counts
          if (existingVote.value === 1) {
            newUpvotes = Math.max(0, upvotes - 1);
          } else {
            newDownvotes = Math.max(0, downvotes - 1);
          }
          // Add new vote to counts
          if (voteValue === 1) {
            newUpvotes = newUpvotes + 1;
          } else {
            newDownvotes = newDownvotes + 1;
          }
          userVote = voteValue;
        }
      } else {
        // New vote
        insertVoteStmt.run(randomUUID(), commentId, userId, voteValue);
        newUpvotes = voteValue === 1 ? upvotes + 1 : upvotes;
        newDownvotes = voteValue === -1 ? downvotes + 1 : downvotes;
        userVote = voteValue;
      }

      // 4. Update comment vote counts
      updateCommentStmt.run(newUpvotes, newDownvotes, commentId);

      const processingTime = Date.now() - startTime;
      console.log(`⚡ SQLite comment vote processed in ${processingTime}ms`);

      finalUserVote = userVote;

      res.json({
        comment_id: commentId,
        upvotes: newUpvotes,
        downvotes: newDownvotes,
        user_vote: userVote,
        processing_time: processingTime
      });
    })();
    
  } catch (error: any) {
    console.error(`❌ Comment vote failed after ${Date.now() - startTime}ms:`, error);
    
    if (error.message === 'COMMENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    res.status(500).json({ error: 'Failed to process comment vote' });
  }
};

// GET /api/v1/comments/:id/vote - Get user's vote on a comment
export const getCommentVote = async (req: Request, res: Response) => {
  try {
    const { id: commentId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(200).json({ user_vote: 0 });
    }

    const getVoteStmt = db.prepare('SELECT value FROM comment_votes WHERE comment_id = ? AND user_id = ?');
    const vote = getVoteStmt.get(commentId, userId) as CommentVoteRow | undefined;

    return res.status(200).json({
      user_vote: vote?.value || 0
    });
  } catch (error) {
    console.error('Get comment vote error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch comment vote' },
    });
  }
};
