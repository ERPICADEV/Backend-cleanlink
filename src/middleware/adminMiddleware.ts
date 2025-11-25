import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';

export const adminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    const admin = await prisma.admin.findUnique({
      where: { userId: req.userId },
    });

    if (!admin) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Admin access required' },
      });
    }

    (req as any).isAdmin = true;
    (req as any).adminRole = admin.role;
    (req as any).adminRegion = admin.regionAssigned;
    
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
    });
  }
};

export const reporterOrAdminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    
    const report = await prisma.report.findUnique({
      where: { id },
      select: { reporterId: true }
    });

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Check if user is reporter or admin
    const isReporter = report.reporterId === req.userId;
    const isAdmin = await prisma.admin.findUnique({
      where: { userId: req.userId! },
    });

    if (!isReporter && !isAdmin) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Not authorized to modify this report' },
      });
    }

    (req as any).isReporter = isReporter;
    (req as any).isAdmin = !!isAdmin;
    
    next();
  } catch (error) {
    console.error('ReporterOrAdmin middleware error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
    });
  }
};