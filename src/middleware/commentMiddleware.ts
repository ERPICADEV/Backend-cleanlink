import { Request, Response, NextFunction } from 'express'
import { pool } from '../config/postgres'

export const commentAuthorMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params // comment id

    const result = await pool.query('SELECT author_id FROM comments WHERE id = $1', [id])
    const comment = result.rows[0] as any

    if (!comment) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Comment not found' },
      })
    }

    // Check if user is the comment author
    if (comment?.author_id !== req.userId) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Not authorized to modify this comment' },
      })
    }

    next()
  } catch (error) {
    console.error('Comment author middleware error:', error)
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
    })
  }
}