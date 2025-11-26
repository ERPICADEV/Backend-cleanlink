import db from '../config/sqlite'
import { randomUUID } from 'crypto'

export interface NotificationData {
  points_earned?: number
  report_id?: string
  new_level?: number
  achievement?: string
}

export class NotificationService {
  static async createNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    data?: NotificationData
  ) {
    try {
      const id = randomUUID()
      const stmt = db.prepare(
        'INSERT INTO notifications (id, userId, type, title, message, data, createdAt, isRead) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      
      const result = stmt.run(
        id,
        userId,
        type,
        title,
        message,
        JSON.stringify(data || {}),
        new Date().toISOString(),
        false
      )
      
      console.log(`📬 Notification created for user ${userId}: ${title}`)
      return { id, userId, type, title, message, data: data || {} }
    } catch (error) {
      console.error('Failed to create notification:', error)
      return null
    }
  }

  // Common notification templates
  static async notifyReportResolved(userId: string, reportId: string, points: number, level: number) {
    return this.createNotification(
      userId,
      'report_resolved',
      'Report Resolved! 🎉',
      `Your garbage report has been cleaned by MCD. You earned ${points} civic points!`,
      { points_earned: points, report_id: reportId, new_level: level }
    )
  }

  static async notifyLevelUp(userId: string, newLevel: number, levelName: string) {
    return this.createNotification(
      userId,
      'level_up',
      'Level Up! ⭐',
      `Congratulations! You've reached ${levelName} (Level ${newLevel})`,
      { new_level: newLevel }
    )
  }

  static async notifyPointsEarned(userId: string, points: number, reason: string) {
    return this.createNotification(
      userId,
      'points_earned',
      'Points Earned! 💰',
      `You earned ${points} points for ${reason}`,
      { points_earned: points }
    )
  }
}