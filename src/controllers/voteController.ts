import { Request, Response } from 'express';
import prisma from '../config/database';

// POST /api/v1/reports/:id/vote
export const voteReport = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { value } = req.body;

    // Validations
    if (value !== 1 && value !== -1) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Vote value must be 1 (upvote) or -1 (downvote)',
          fields: { value: 'Invalid vote value' },
        },
      });
    }

    // Check if report exists and store for engagement points
    const report = await prisma.report.findUnique({
      where: { id },
    });

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Check for existing vote
    const existingVote = await prisma.vote.findUnique({
      where: {
        reportId_userId: {
          reportId: id,
          userId: req.userId!,
        },
      },
    });

    await prisma.$transaction(async (tx) => {
      if (existingVote) {
        // Update existing vote
        if (existingVote.value === value) {
          // Same vote - remove it
          await tx.vote.delete({
            where: {
              reportId_userId: {
                reportId: id,
                userId: req.userId!,
              },
            },
          });

          // Update report vote counts
          await tx.report.update({
            where: { id },
            data: {
              upvotes: value === 1 ? { decrement: 1 } : undefined,
              downvotes: value === -1 ? { decrement: 1 } : undefined,
            },
          });
        } else {
          // Change vote
          await tx.vote.update({
            where: {
              reportId_userId: {
                reportId: id,
                userId: req.userId!,
              },
            },
            data: { value },
          });

          // Update report vote counts
          await tx.report.update({
            where: { id },
            data: {
              upvotes: value === 1 ? { increment: 1 } : { decrement: 1 },
              downvotes: value === -1 ? { increment: 1 } : { decrement: 1 },
            },
          });
        }
      } else {
        // Create new vote
        await tx.vote.create({
          data: {
            reportId: id,
            userId: req.userId!,
            value,
          },
        });

        // Update report vote counts
        await tx.report.update({
          where: { id },
          data: {
            upvotes: value === 1 ? { increment: 1 } : undefined,
            downvotes: value === -1 ? { increment: 1 } : undefined,
          },
        });
      }

      // Recalculate community score
      const updatedReport = await tx.report.findUnique({
        where: { id },
        select: { upvotes: true, downvotes: true },
      });

      if (updatedReport) {
        const communityScore = calculateCommunityScore(
          updatedReport.upvotes,
          updatedReport.downvotes
        );

        await tx.report.update({
          where: { id },
          data: { communityScore },
        });
      }
    });

    // Get final vote counts
    const finalReport = await prisma.report.findUnique({
      where: { id },
      select: {
        upvotes: true,
        downvotes: true,
        communityScore: true,
      },
    });

    // Award engagement points when report reaches vote milestones
    const voteCount = finalReport?.upvotes || 0;
    const engagementMilestones = [10, 25, 50];
    const milestonePoints: {[key: number]: number} = {10: 5, 25: 10, 50: 15};

    if (engagementMilestones.includes(voteCount) && report.reporterId) {
      const engagementPoints = milestonePoints[voteCount];
      
      await prisma.user.update({
        where: { id: report.reporterId },
        data: {
          civicPoints: { increment: engagementPoints }
        }
      });
      
      console.log(`🎉 Awarded ${engagementPoints} engagement points for reaching ${voteCount} upvotes`);
    }

    return res.status(200).json({
      report_id: id,
      upvotes: finalReport?.upvotes || 0,
      downvotes: finalReport?.downvotes || 0,
      score: finalReport?.communityScore || 0,
      user_vote: existingVote && existingVote.value === value ? 0 : value, // 0 means no vote
    });
  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to process vote' },
    });
  }
};

function calculateCommunityScore(upvotes: number, downvotes: number): number {
  const total = upvotes + downvotes;
  if (total === 0) return 0;
  return (upvotes - downvotes) / total;
}