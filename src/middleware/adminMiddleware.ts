import { Request, Response, NextFunction } from 'express'
import db from '../config/sqlite'

declare global {
  namespace Express {
    interface Request {
      isAdmin?: boolean
      adminRole?: string
      adminRegion?: string
      isReporter?: boolean
    }
  }
}

export const adminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      })
    }

    const stmt = db.prepare('SELECT * FROM admins WHERE userId = ?')
    const admin = stmt.get(req.userId!) as any

    if (!admin) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Admin access required' },
      })
    }

    req.isAdmin = true
    req.adminRole = admin.role
    req.adminRegion = admin.regionAssigned
    
    next()
  } catch (error) {
    console.error('Admin middleware error:', error)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
    })
  }
}

export const reporterOrAdminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    
    const stmt = db.prepare('SELECT reporterId FROM reports WHERE id = ?')
    const report = stmt.get(id)! as any

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      })
    }

    // Check if user is reporter or admin
    const isReporter = report.reporterId === req.userId
    
    const adminStmt = db.prepare('SELECT * FROM admins WHERE userId = ?')
    const isAdmin = adminStmt.get(req.userId!)! as any

    if (!isReporter && !isAdmin) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Not authorized to modify this report' },
      })
    }

    req.isReporter = isReporter
    req.isAdmin = !!isAdmin
    
    next()
  } catch (error) {
    console.error('ReporterOrAdmin middleware error:', error)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
    })
  }
}