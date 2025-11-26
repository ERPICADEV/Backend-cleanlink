import { Request, Response } from 'express';
import prisma from '../config/database';

// POST /api/v1/reports/:id/vote - MINIMAL VERSION
export const voteReport = async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const { value } = req.body;
    const userId = req.userId!;


    // MINIMAL TRANSACTION - Only essential operations
    const result = await prisma.$transaction(async (tx) => {
      
      // 1. Check existing vote and get current counts in ONE query
      const [existingVote, report] = await Promise.all([
        tx.vote.findUnique({
          where: { reportId_userId: { reportId: id, userId } },
          select: { value: true }
        }),
        tx.report.findUnique({
          where: { id },
          select: { upvotes: true, downvotes: true, reporterId: true }
        })
      ]);
      if (!report) throw new Error('REPORT_NOT_FOUND');

      const { upvotes, downvotes, reporterId } = report;
      
      // 2. Calculate changes
      let upvoteChange = 0;
      let downvoteChange = 0;
      let userVote = value;

      
      if (existingVote) {
        if (existingVote.value === value) {
          
          await tx.vote.delete({
            where: { reportId_userId: { reportId: id, userId } }
          });
          upvoteChange = value === 1 ? -1 : 0;
          downvoteChange = value === -1 ? -1 : 0;
          userVote = 0;
        } else {
          await tx.vote.update({
            where: { reportId_userId: { reportId: id, userId } },
            data: { value }
          });
          upvoteChange = value === 1 ? 1 : -1;
          downvoteChange = value === -1 ? 1 : -1;
        }
      } else {
        await tx.vote.create({
          data: { reportId: id, userId, value }
        });
        upvoteChange = value === 1 ? 1 : 0;
        downvoteChange = value === -1 ? 1 : 0;
      }

      // 3. Single atomic update
      const newUpvotes = upvotes + upvoteChange;
      const newDownvotes = downvotes + downvoteChange;
      const communityScore = (newUpvotes - newDownvotes) / Math.max(1, newUpvotes + newDownvotes);
      
      await tx.report.update({
        where: { id },
        data: { upvotes: newUpvotes, downvotes: newDownvotes, communityScore }
      });

      return { newUpvotes, newDownvotes, communityScore, userVote, reporterId };
    }, {
      // Add transaction timeout
      timeout: 10000,
      maxWait: 5000
    });

   
    // Return immediately - don't wait for background
    res.json({
      report_id: id,
      upvotes: result.newUpvotes,
      downvotes: result.newDownvotes,
      score: result.communityScore,
      user_vote: result.userVote,
    });

  } catch (error: any) {
    console.error(`❌ Vote failed after ${Date.now() - startTime}ms:`, error);
    console.error('❌ Full error details:', error);
    
    if (error.message === 'REPORT_NOT_FOUND') {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    res.status(500).json({ error: 'Failed to process vote' });
  }
};

async function processEngagementPoints(reporterId: string, upvotes: number) {
  // Remove this entirely for now to test speed
  return;
  
  // Or keep it minimal:
  const milestones = { 10: 5, 25: 10, 50: 15 };
  if (milestones[upvotes as keyof typeof milestones]) {
    await prisma.user.updateMany({
      where: { id: reporterId },
      data: { civicPoints: { increment: milestones[upvotes as keyof typeof milestones] } }
    });
  }
}