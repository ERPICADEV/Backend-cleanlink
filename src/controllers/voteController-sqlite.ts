import { Request, Response } from 'express';
import db from '../config/sqlite';
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

    console.log('🔍 Starting SQLite vote...');

    // Prepare statements with proper typing
    const getReportStmt = db.prepare('SELECT upvotes, downvotes, reporter_id FROM reports WHERE id = ?');
    const getVoteStmt = db.prepare('SELECT value FROM votes WHERE report_id = ? AND user_id = ?')
    const deleteVoteStmt = db.prepare('DELETE FROM votes WHERE report_id = ? AND user_id = ?')
    const updateVoteStmt = db.prepare('UPDATE votes SET value = ? WHERE report_id = ? AND user_id = ?')
    const insertVoteStmt = db.prepare('INSERT INTO votes (id, report_id, user_id, value) VALUES (?, ?, ?, ?)')
    const updateReportStmt = db.prepare('UPDATE reports SET upvotes = ?, downvotes = ?, community_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')

    // Transaction for atomic operations
    let reportOwnerId: string | null = null;
    let finalUserVote = voteValue;

    db.transaction(() => {
      // 1. Get report with type assertion
      const report = getReportStmt.get(id) as ReportRow | undefined;
      if (!report) {
        throw new Error('REPORT_NOT_FOUND');
      }

      const { upvotes, downvotes, reporter_id } = report;
      reportOwnerId = reporter_id || null;

      // 2. Check existing vote with type assertion
      const existingVote = getVoteStmt.get(id, userId) as VoteRow | undefined;
      
      let userVote = voteValue;
      let newUpvotes = upvotes;
      let newDownvotes = downvotes;

      // 3. Handle vote logic
      if (existingVote) {
        if (existingVote.value === voteValue) {
          // User clicked the same vote button - toggle off (remove vote, set to 0)
          deleteVoteStmt.run(id, userId);
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
          updateVoteStmt.run(voteValue, id, userId);
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
        insertVoteStmt.run(randomUUID(), id, userId, voteValue);
        newUpvotes = voteValue === 1 ? upvotes + 1 : upvotes;
        newDownvotes = voteValue === -1 ? downvotes + 1 : downvotes;
        userVote = voteValue;
      }

      // 4. Calculate score and update report
      const communityScore = (newUpvotes - newDownvotes) / Math.max(1, newUpvotes + newDownvotes);
      updateReportStmt.run(newUpvotes, newDownvotes, communityScore, id);

      const processingTime = Date.now() - startTime;
      console.log(`⚡ SQLite vote processed in ${processingTime}ms`);

      finalUserVote = userVote;

      res.json({
        report_id: id,
        upvotes: newUpvotes,
        downvotes: newDownvotes,
        score: communityScore,
        user_vote: userVote,
        processing_time: processingTime
      });
    })();

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