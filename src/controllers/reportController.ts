import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { enqueueAIAnalysis } from '../utils/queue';
import { withRetry } from '../utils/databaseRetry';


// GET /api/v1/reports (feed)
// GET /api/v1/reports (feed)
// GET /api/v1/reports (feed) - NO ADMIN CHECK VERSION
export const getReports = async (req: Request, res: Response) => {
    try {
      const { 
        category, 
        status, 
        sort = 'new', 
        cursor, 
        limit = 20,
        reporter_id
      } = req.query;
  
      const where: Prisma.ReportWhereInput = {};
      
      if (typeof category === 'string' && category.trim()) {
        where.category = {
          equals: category.trim(),
          mode: 'insensitive'
        };
      }
      if (typeof status === 'string' && status.trim()) {
        where.status = {
          equals: status.trim(),
          mode: 'insensitive'
        };
      }
      if (typeof reporter_id === 'string' && reporter_id.trim()) {
        where.reporterId = reporter_id.trim();
      }
  
      const orderBy: any = {};
      switch (sort) {
        case 'hot':
          orderBy.communityScore = 'desc';
          break;
        case 'top':
          orderBy.upvotes = 'desc';
          break;
        default: // 'new'
          orderBy.createdAt = 'desc';
      }
  // Define selectFields for getReports
      const selectFields = {
        reporterId: true,
        reporterDisplay: true,
      };

      const reports = await prisma.report.findMany({
        where,
        orderBy,
        take: parseInt(limit as string) + 1,
        cursor: cursor ? { id: cursor as string } : undefined,
        select: {
          ...selectFields,
          id: true,
          title: true,
          description: true,
          category: true,
          images: true,
          location: true,
          visibility: true,
          upvotes: true,
          downvotes: true,
          communityScore: true,
          status: true,
          createdAt: true,
          reporterDisplay: true,
          _count: {
            select: { comments: true }
          }
        },
      });
  
      let nextCursor = undefined;
      if (reports.length > parseInt(limit as string)) {
        nextCursor = reports[reports.length - 1].id;
        reports.pop();
      }
  
      // ALWAYS mask coordinates for public feed - admin can use separate endpoint
      const maskedReports = reports.map(report => {
        const reportData: any = { ...report };
        
        // Always mask coordinates in public feed
        if (reportData.location && reportData.visibility === 'masked') {
          const { lat, lng, ...restLocation } = reportData.location as any;
          reportData.location = restLocation;
        }
        
        return {
          ...reportData,
          comments_count: report._count.comments,
          description_preview: report.description.substring(0, 100) + (report.description.length > 100 ? '...' : '')
        };
      });
  
      return res.status(200).json({
        data: maskedReports,
        paging: nextCursor ? { next_cursor: nextCursor } : null
      });
    } catch (error) {
      console.error('Get reports error:', error);
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch reports' },
      });
    }
  };
// POST /api/v1/reports
// POST /api/v1/reports
export const createReport = async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      category,
      images,
      location,
      anonymous = false,
      client_idempotency_key
    } = req.body;

    // Validations omitted for brevity...

    const reporterId = anonymous ? null : req.userId;
    const reporterDisplay = anonymous ? 'Anonymous' : (req as any).userEmail || 'User';

    const report = await prisma.report.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        category,
        images,
        location,
        visibility: location.visibility || 'public',
        reporterId,
        reporterDisplay,
        communityScore: calculateCommunityScore(0, 0),
      },
    });

    // 🔍 DEBUG LOGS FOR TESTING
    console.log('✅ Report created:', report.id);
    console.log('📋 Calling enqueueAIAnalysis...');

    try {
      await enqueueAIAnalysis(report.id);
      console.log('🎯 AI queuing completed for report:', report.id);
    } catch (aiError) {
      console.error('❌ Failed to enqueue AI analysis:', aiError);
      // Do NOT fail the whole request—only log
    }

    return res.status(201).json({
      id: report.id,
      status: report.status,
      ai_check: 'queued',
      created_at: report.createdAt,
      points_awarded: 0
    });
  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create report' },
    });
  }
};


// GET /api/v1/reports/:id
export const getReport = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Check if user is admin
    const isAdmin = req.userId ? await prisma.admin.findUnique({
      where: { userId: req.userId },
    }) : false;
    
    const { fields } = req.query;
    
    const selectFields = fields ? 
      JSON.parse(fields as string).reduce((acc: any, field: string) => {
        acc[field] = true;
        return acc;
      }, {}) 
      : {
        id: true,
        title: true,
        upvotes: true,
        downvotes: true,
        status: true,
        category: true,
        createdAt: true,
        comments_count: true,
        // Remove heavy fields
        // description: true, // Only if needed
        // images: true,      // Only if needed  
      };

    const report = await withRetry(() =>
      prisma.report.findUnique({
        where: { id },
        include: {
          reporter: {
            select: {
              id: true,
              username: true,
              email: isAdmin ? true : false,
            }
          },
          comments: {
            include: {
              author: {
                select: {
                  id: true,
                  username: true,
                  badges: true,
                }
              }
            },
            orderBy: { createdAt: 'asc' }
          },
          _count: {
            select: { votes: true }
          }
        },
      })
    );
    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Mask coordinates for non-admin users
    let responseReport: any = { ...report };
    if (!isAdmin && report.visibility === 'masked' && report.location) {
      const { lat, lng, ...restLocation } = report.location as any;
      responseReport.location = restLocation;
    }

    // Hide reporter email for non-admin
    if (!isAdmin && responseReport.reporter) {
      delete responseReport.reporter.email;
    }

    return res.status(200).json(responseReport);
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch report' },
    });
  }
};

// PATCH /api/v1/reports/:id
export const updateReport = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Use the isAdmin from middleware
    const isAdmin = (req as any).isAdmin;

    const existingReport = await prisma.report.findUnique({
      where: { id },
    });

    if (!existingReport) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Authorization: Only reporter or admin can update
    const isReporter = existingReport.reporterId === req.userId;
    if (!isReporter && !isAdmin) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Not authorized to update this report' },
      });
    }

    // Reporter can only edit pending reports
    if (isReporter && existingReport.status !== 'pending') {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Can only edit pending reports' },
      });
    }

    const updatedReport = await prisma.report.update({
      where: { id },
      data: updates,
    });

    // TODO: Create audit log for admin actions
    if (isAdmin && updates.status === 'resolved') {
      // TODO: Award points to reporter
    }

    return res.status(200).json(updatedReport);
  } catch (error) {
    console.error('Update report error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to update report' },
    });
  }
};

function calculateCommunityScore(upvotes: number, downvotes: number): number {
  const total = upvotes + downvotes;
  if (total === 0) return 0;
  return (upvotes - downvotes) / total;
}