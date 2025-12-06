// src/middleware/adminRoles.ts
// 🔐 Admin Role & Permission Middleware

import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/postgres'
import { AdminRole, hasPermission } from '../lib/permissions'

// Extend Express Request type to include admin info
declare global {
  namespace Express {
    interface Request {
      adminRole?: AdminRole
      adminId?: string
      userId?: string
      isAdmin?: boolean
      isSuperAdmin?: boolean
    }
  }
}

/**
 * Middleware: Check if user is an admin (any role)
 * Adds admin info to request object
 */
export const adminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      })
    }

    const result = await pool.query('SELECT id, role, status FROM admins WHERE user_id = $1', [req.userId])
    const admin = result.rows[0] as any

    if (!admin) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Admin access required' },
      })
    }

    // Check if admin is active
    if (admin.status !== 'active') {
      return res.status(403).json({
        error: { 
          code: 'FORBIDDEN', 
          message: `Admin account is ${admin.status}. Contact super admin.` 
        },
      })
    }

    // Attach admin info to request
    req.adminRole = admin.role as AdminRole
    req.adminId = admin.id
    req.isAdmin = true
    req.isSuperAdmin = admin.role === AdminRole.SUPERADMIN

    next()
  } catch (error) {
    console.error('Admin middleware error:', error)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
    })
  }
}

/**
 * Middleware: Only SuperAdmin can pass
 */
export const superAdminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.adminRole !== AdminRole.SUPERADMIN) {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'SuperAdmin access required for this action',
      },
    })
  }
  next()
}

/**
 * Middleware: Check specific permission
 * Usage: requirePermission('ASSIGN_REPORTS')
 */
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.adminRole) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Admin role not found' },
      })
    }

    if (!hasPermission(req.adminRole, permission)) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: `Permission denied: ${permission}`,
          details: `Your role (${req.adminRole}) does not have this permission`,
        },
      })
    }
    next()
  }
}

/**
 * Middleware: Add helper function to check report access
 * SuperAdmin can access all, Admin can only access assigned reports
 */
export const canAccessReport = (req: Request, res: Response, next: NextFunction) => {
  // Add helper function to request object
  (req as any).canAccessReport = async (reportId: string): Promise<boolean> => {
    // SuperAdmin can access all reports
    if (req.isSuperAdmin) return true

    // Check if report is assigned to this admin
    const result = await pool.query(`
      SELECT admin_id FROM report_progress 
      WHERE report_id = $1 AND admin_id = $2
    `, [reportId, req.adminId])
    return !!result.rows[0]
  }

  next()
}

/**
 * Middleware: Ensure admin can only access their assigned reports
 * Use this on endpoints where admin should only see their work
 */
export const assignedReportsOnly = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reportId = req.params.id || req.params.reportId

    if (!reportId) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Report ID required' },
      })
    }

    // SuperAdmin can access all
    if (req.isSuperAdmin) {
      return next()
    }

    // Check if report is assigned to this admin
    const result = await pool.query(`
      SELECT id FROM report_progress 
      WHERE report_id = $1 AND admin_id = $2
    `, [reportId, req.adminId])
    const assignment = result.rows[0]

    if (!assignment) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'This report is not assigned to you',
        },
      })
    }

    next()
  } catch (error) {
    console.error('Assigned reports check error:', error)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
    })
  }
}

/**
 * Middleware: Block viewers from taking actions
 * Viewers can only view, not modify
 */
export const noViewerAccess = (req: Request, res: Response, next: NextFunction) => {
  if (req.adminRole === AdminRole.VIEWER) {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Viewers cannot perform this action. Read-only access.',
      },
    })
  }
  next()
}