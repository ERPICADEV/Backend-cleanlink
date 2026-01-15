"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markAsRead = exports.getUnreadCount = exports.getNotifications = void 0;
const postgres_1 = require("../config/postgres");
// GET /api/v1/notifications
const getNotifications = async (req, res) => {
    try {
        const { limit = 20, cursor, unread_only } = req.query;
        let whereClause = 'WHERE user_id = $1';
        const params = [req.userId];
        let paramIndex = 2;
        if (unread_only === 'true') {
            whereClause += ' AND is_read = false';
        }
        if (cursor) {
            whereClause += ` AND id < $${paramIndex}`;
            params.push(cursor);
            paramIndex++;
        }
        const sql = `
      SELECT id, type, title, message, data, is_read, created_at
      FROM notifications 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}
    `;
        params.push(parseInt(limit) + 1);
        const result = await postgres_1.pool.query(sql, params);
        const notifications = result.rows;
        let nextCursor = undefined;
        if (notifications.length > parseInt(limit)) {
            nextCursor = notifications[notifications.length - 1].id;
            notifications.pop();
        }
        // Mark as read if viewing unread notifications
        if (unread_only === 'true' && notifications.length > 0) {
            const notificationIds = notifications.map((n) => n.id);
            const placeholders = notificationIds.map((_, i) => `$${i + 1}`).join(',');
            await postgres_1.pool.query(`
        UPDATE notifications 
        SET is_read = true 
        WHERE id IN (${placeholders}) AND is_read = false
      `, notificationIds);
        }
        // Parse JSON data field
        const formattedNotifications = notifications.map((notification) => ({
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
    }
    catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch notifications' },
        });
    }
};
exports.getNotifications = getNotifications;
// GET /api/v1/notifications/unread-count
const getUnreadCount = async (req, res) => {
    try {
        const result = await postgres_1.pool.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false', [req.userId]);
        return res.status(200).json({ count: parseInt(result.rows[0].count) });
    }
    catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to get unread count' },
        });
    }
};
exports.getUnreadCount = getUnreadCount;
// PATCH /api/v1/notifications/:id/read
const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({
                error: { code: 'BAD_REQUEST', message: 'Notification ID is required' },
            });
        }
        // Verify notification exists and belongs to the user
        const checkResult = await postgres_1.pool.query('SELECT id, is_read FROM notifications WHERE id = $1 AND user_id = $2', [id, req.userId]);
        const notification = checkResult.rows[0];
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
        await postgres_1.pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [id, req.userId]);
        return res.status(200).json({
            id: notification.id,
            isRead: true,
        });
    }
    catch (error) {
        console.error('Mark notification as read error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to mark notification as read' },
        });
    }
};
exports.markAsRead = markAsRead;
