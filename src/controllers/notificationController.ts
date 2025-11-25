import { Request, Response } from 'express';
import prisma from '../config/database';

// GET /api/v1/notifications
export const getNotifications = async (req: Request, res: Response) => {
  try {
    const { limit = 20, cursor, unread_only } = req.query;

    const where: any = { userId: req.userId };
    if (unread_only === 'true') {
      where.isRead = false;
    }

    const notifications = await prisma.notification.findMany({
      where,
      take: parseInt(limit as string) + 1,
      cursor: cursor ? { id: cursor as string } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        data: true,
        isRead: true,
        createdAt: true,
      },
    });

    let nextCursor = undefined;
    if (notifications.length > parseInt(limit as string)) {
      nextCursor = notifications[notifications.length - 1].id;
      notifications.pop();
    }

    // Mark as read if viewing unread notifications
    if (unread_only === 'true' && notifications.length > 0) {
      await prisma.notification.updateMany({
        where: {
          id: { in: notifications.map(n => n.id) },
          isRead: false,
        },
        data: { isRead: true },
      });
    }

    return res.status(200).json({
      data: notifications,
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
    const count = await prisma.notification.count({
      where: {
        userId: req.userId,
        isRead: false,
      },
    });

    return res.status(200).json({ count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get unread count' },
    });
  }
};