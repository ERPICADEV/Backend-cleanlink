import { Request, Response } from 'express';
import db from '../config/sqlite';

// GET /api/v1/notifications
export const getNotifications = async (req: Request, res: Response) => {
  try {
    const { limit = 20, cursor, unread_only } = req.query;

    let whereClause = 'WHERE user_id = ?';
    const params: any[] = [req.userId];

    if (unread_only === 'true') {
      whereClause += ' AND is_read = false';
    }

    if (cursor) {
      whereClause += ' AND id < ?';
      params.push(cursor);
    }

    const sql = `
      SELECT id, type, title, message, data, is_read, created_at
      FROM notifications 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ?
    `;
    
    params.push(parseInt(limit as string) + 1);

    const stmt = db.prepare(sql);
    const notifications = stmt.all(...params) as any[];

    let nextCursor = undefined;
    if (notifications.length > parseInt(limit as string)) {
      nextCursor = notifications[notifications.length - 1].id;
      notifications.pop();
    }

    // Mark as read if viewing unread notifications
    if (unread_only === 'true' && notifications.length > 0) {
      const notificationIds = notifications.map((n: any) => n.id);
      const placeholders = notificationIds.map(() => '?').join(',');
      
      const updateStmt = db.prepare(`
        UPDATE notifications 
        SET is_read = true 
        WHERE id IN (${placeholders}) AND is_read = false
      `);
      updateStmt.run(...notificationIds);
    }

    // Parse JSON data field
    const formattedNotifications = notifications.map((notification: any) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data ? JSON.parse(notification.data) : null,
      isRead: notification.is_read,
      createdAt: notification.created_at
    }));

    return res.status(200).json({
      data: formattedNotifications,
      paging: nextCursor ? { next_cursor: nextCursor } : null,
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch notifications' },
    });
  }
};

// GET /api/v1/notifications/unread-count
export const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = false');
    const result: any = countStmt.get(req.userId);

    return res.status(200).json({ count: result.count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get unread count' },
    });
  }
};

// PATCH /api/v1/notifications/:id/read
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Notification ID is required' },
      });
    }

    // Verify notification exists and belongs to the user
    const checkStmt = db.prepare('SELECT id, is_read FROM notifications WHERE id = ? AND user_id = ?');
    const notification: any = checkStmt.get(id, req.userId);

    if (!notification) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Notification not found' },
      });
    }

    // If already read, return success
    if (notification.is_read) {
      return res.status(200).json({
        id: notification.id,
        isRead: true,
      });
    }

    // Mark as read
    const updateStmt = db.prepare('UPDATE notifications SET is_read = true WHERE id = ? AND user_id = ?');
    updateStmt.run(id, req.userId);

    return res.status(200).json({
      id: notification.id,
      isRead: true,
    });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to mark notification as read' },
    });
  }
};