import { Request, Response } from 'express';
import { pool } from '../config/postgres';
import { randomUUID } from 'crypto';
import { NotificationService } from '../services/notificationService';

// Define types
interface ReportRow {
  upvotes: number;
  downvotes: number;
  reporter_id?: string | null;
}

interface VoteRow {
  value: number;
}

export const voteReport = async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const { value } = req.body;
    const userId = req.userId!;

    const voteValue = typeof value === 'string' ? parseInt(value) : value;

    if (voteValue !== 1 && voteValue !== -1) {
      return res.status(400).json({ error: 'Invalid vote value' });
    }

    // Transaction for atomic operations
    const client = await pool.connect();
    let reportOwnerId: string | null = null;
    let finalUserVote = voteValue;

    try {
      await client.query('BEGIN');

      // 1. Get report
      const reportResult = await client.query('SELECT upvotes, downvotes, reporter_id FROM reports WHERE id = $1', [id]);
      const report = reportResult.rows[0] as ReportRow | undefined;
      if (!report) {
        throw new Error('REPORT_NOT_FOUND');
      }

      const { upvotes, downvotes, reporter_id } = report;
      reportOwnerId = reporter_id || null;

      // 2. Check existing vote
      const voteResult = await client.query('SELECT value FROM votes WHERE report_id = $1 AND user_id = $2', [id, userId]);
      const existingVote = voteResult.rows[0] as VoteRow | undefined;
      
      let userVote = voteValue;
      let newUpvotes = upvotes;
      let newDownvotes = downvotes;

      // 3. Handle vote logic
      if (existingVote) {
        if (existingVote.value === voteValue) {
          // User clicked the same vote button - toggle off (remove vote, set to 0)
          await client.query('DELETE FROM votes WHERE report_id = $1 AND user_id = $2', [id, userId]);
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
          await client.query('UPDATE votes SET value = $1 WHERE report_id = $2 AND user_id = $3', [voteValue, id, userId]);
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
        await client.query('INSERT INTO votes (id, report_id, user_id, value) VALUES ($1, $2, $3, $4)', [randomUUID(), id, userId, voteValue]);
        newUpvotes = voteValue === 1 ? upvotes + 1 : upvotes;
        newDownvotes = voteValue === -1 ? downvotes + 1 : downvotes;
        userVote = voteValue;
      }

      // 4. Calculate score and update report
      const communityScore = (newUpvotes - newDownvotes) / Math.max(1, newUpvotes + newDownvotes);
      await client.query('UPDATE reports SET upvotes = $1, downvotes = $2, community_score = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4', [newUpvotes, newDownvotes, communityScore, id]);

      await client.query('COMMIT');

      const processingTime = Date.now() - startTime;
      finalUserVote = userVote;

      res.json({
        report_id: id,
        upvotes: newUpvotes,
        downvotes: newDownvotes,
        score: communityScore,
        user_vote: userVote,
        processing_time: processingTime
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Send notification outside of transaction (fire-and-forget)
    if (reportOwnerId && reportOwnerId !== userId && finalUserVote !== 0) {
      NotificationService.notifyVote(reportOwnerId, id, finalUserVote);
    }
    
  } catch (error: any) {
    console.error(`❌ Vote failed after ${Date.now() - startTime}ms:`, error);
    
    if (error.message === 'REPORT_NOT_FOUND') {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    res.status(500).json({ error: 'Failed to process vote' });
  }
};