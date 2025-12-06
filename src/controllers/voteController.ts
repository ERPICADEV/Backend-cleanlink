import { Request, Response } from 'express';
import { pool } from '../config/postgres';
import { randomUUID } from 'crypto';
import { NotificationService } from '../services/notificationService';
import { calculateVoteChange, calculateCommunityScore, isValidVoteValue, type VoteState } from '../utils/voteLogic';

interface VoteRow {
  value: number;
}

/**
 * POST /api/v1/reports/:id/vote
 * Reddit-style voting: click same button = remove vote, click opposite = change vote
 */
export const voteReport = async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const { value } = req.body;
    const userId = req.userId!;

    // Validate vote value
    const voteValue = typeof value === 'string' ? parseInt(value) : value;
    if (!isValidVoteValue(voteValue)) {
      return res.status(400).json({ error: 'Invalid vote value. Must be 1 (upvote) or -1 (downvote)' });
    }

    const client = await pool.connect();
    let reportOwnerId: string | null = null;

    try {
      await client.query('BEGIN');

      // 1. Get report and current vote counts (source of truth from votes table)
      const reportResult = await client.query(`
        SELECT 
          r.reporter_id,
          COALESCE((SELECT COUNT(*)::INTEGER FROM votes WHERE report_id = r.id AND value = 1), 0) as upvotes,
          COALESCE((SELECT COUNT(*)::INTEGER FROM votes WHERE report_id = r.id AND value = -1), 0) as downvotes
        FROM reports r
        WHERE r.id = $1
      `, [id]);

      const report = reportResult.rows[0];
      if (!report) {
        throw new Error('REPORT_NOT_FOUND');
      }

      const currentUpvotes = parseInt(report.upvotes) || 0;
      const currentDownvotes = parseInt(report.downvotes) || 0;
      reportOwnerId = report.reporter_id || null;

      // 2. Get user's existing vote
      const voteResult = await client.query(
        'SELECT value FROM votes WHERE report_id = $1 AND user_id = $2',
        [id, userId]
      );
      const existingVote = voteResult.rows[0] as VoteRow | undefined;
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
          'DELETE FROM votes WHERE report_id = $1 AND user_id = $2',
          [id, userId]
        );
      } else {
        // Use UPSERT to handle race conditions: INSERT or UPDATE if exists
        // This prevents duplicate key errors when multiple requests come in simultaneously
        await client.query(
          `INSERT INTO votes (id, report_id, user_id, value) 
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (report_id, user_id) 
           DO UPDATE SET value = $4`,
          [randomUUID(), id, userId, newUserVote]
        );
      }

      // 5. Update report with new counts and score
      const communityScore = calculateCommunityScore(newUpvotes, newDownvotes);
      await client.query(
        'UPDATE reports SET upvotes = $1, downvotes = $2, community_score = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
        [newUpvotes, newDownvotes, communityScore, id]
      );

      await client.query('COMMIT');

      // 6. Recalculate vote counts from database (source of truth) to ensure accuracy
      // This prevents flicker by returning the actual database state, not calculated values
      const finalCountResult = await client.query(`
        SELECT 
          COALESCE((SELECT COUNT(*)::INTEGER FROM votes WHERE report_id = $1 AND value = 1), 0) as upvotes,
          COALESCE((SELECT COUNT(*)::INTEGER FROM votes WHERE report_id = $1 AND value = -1), 0) as downvotes
      `, [id]);

      const finalCounts = finalCountResult.rows[0];
      const finalUpvotes = parseInt(finalCounts.upvotes) || 0;
      const finalDownvotes = parseInt(finalCounts.downvotes) || 0;
      const finalCommunityScore = calculateCommunityScore(finalUpvotes, finalDownvotes);

      // 7. Send notification (fire-and-forget, outside transaction)
      if (reportOwnerId && reportOwnerId !== userId && newUserVote !== 0) {
        NotificationService.notifyVote(reportOwnerId, id, newUserVote);
      }

      const processingTime = Date.now() - startTime;

      // Return actual database counts, not calculated values
      // This ensures the client receives the authoritative state
      res.json({
        report_id: id,
        upvotes: finalUpvotes,
        downvotes: finalDownvotes,
        score: finalCommunityScore,
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
    console.error(`❌ Vote failed after ${Date.now() - startTime}ms:`, error);
    
    if (error.message === 'REPORT_NOT_FOUND') {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    res.status(500).json({ error: 'Failed to process vote' });
  }
};
