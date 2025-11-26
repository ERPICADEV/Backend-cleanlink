"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUnreadCount = exports.getNotifications = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
// GET /api/v1/notifications
const getNotifications = async (req, res) => {
    try {
        const { limit = 20, cursor, unread_only } = req.query;
        let whereClause = 'WHERE user_id = ?';
        const params = [req.userId];
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
        params.push(parseInt(limit) + 1);
        const stmt = sqlite_1.default.prepare(sql);
        const notifications = stmt.all(...params);
        let nextCursor = undefined;
        if (notifications.length > parseInt(limit)) {
            nextCursor = notifications[notifications.length - 1].id;
            notifications.pop();
        }
        // Mark as read if viewing unread notifications
        if (unread_only === 'true' && notifications.length > 0) {
            const notificationIds = notifications.map((n) => n.id);
            const placeholders = notificationIds.map(() => '?').join(',');
            const updateStmt = sqlite_1.default.prepare(`
        UPDATE notifications 
        SET is_read = true 
        WHERE id IN (${placeholders}) AND is_read = false
      `);
            updateStmt.run(...notificationIds);
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
        const countStmt = sqlite_1.default.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = false');
        const result = countStmt.get(req.userId);
        return res.status(200).json({ count: result.count });
    }
    catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to get unread count' },
        });
    }
};
exports.getUnreadCount = getUnreadCount;
