import db from '../config/sqlite';
import { randomUUID } from 'crypto';

export interface NotificationData {
  points_earned?: number;
  report_id?: string;
  new_level?: number;
  achievement?: string;
  reward_id?: string;
  reward_title?: string;
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
      const id = randomUUID();
      const stmt = db.prepare(
        // Column names must match SQLite schema (config/sqlite.ts)
        'INSERT INTO notifications (id, user_id, type, title, message, data, created_at, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      
      const result = stmt.run(
        id,
        userId,
        type,
        title,
        message,
        JSON.stringify(data || {}),
        new Date().toISOString(),
        0 // SQLite boolean: 0 = false, 1 = true
      );
      
      console.log(`📬 Notification created for user ${userId}: ${title}`);
      return { id, userId, type, title, message, data: data || {} };
    } catch (error) {
      console.error('Failed to create notification:', error);
      return null;
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
    );
  }

  static async notifyLevelUp(userId: string, newLevel: number, levelName: string) {
    return this.createNotification(
      userId,
      'level_up',
      'Level Up! ⭐',
      `Congratulations! You've reached ${levelName} (Level ${newLevel})`,
      { new_level: newLevel }
    );
  }

  static async notifyPointsEarned(userId: string, points: number, reason: string) {
    return this.createNotification(
      userId,
      'points_earned',
      'Points Earned! 💰',
      `You earned ${points} points for ${reason}`,
      { points_earned: points }
    );
  }

  static async notifyNewComment(
    reportOwnerId: string,
    reportId: string,
    commenterName: string | null,
    snippet: string
  ) {
    const displayName = commenterName || 'Someone';
    return this.createNotification(
      reportOwnerId,
      'comment_new',
      'New comment on your report 💬',
      `${displayName} commented on your report: "${snippet}"`,
      { report_id: reportId }
    );
  }

  static async notifyVote(
    reportOwnerId: string,
    reportId: string,
    voteValue: number
  ) {
    const isUpvote = voteValue === 1;
    return this.createNotification(
      reportOwnerId,
      'vote_cast',
      isUpvote ? 'Your report got an upvote 👍' : 'Your report got a downvote 👎',
      isUpvote
        ? 'Someone upvoted your civic report.'
        : 'Someone downvoted your civic report.',
      { report_id: reportId }
    );
  }

  static async notifyRewardRedeemed(
    userId: string,
    rewardId: string,
    rewardTitle: string,
    pointsDeducted: number
  ) {
    return this.createNotification(
      userId,
      'reward_redeemed',
      'Reward redemption requested 🎁',
      `You redeemed "${rewardTitle}" for ${pointsDeducted} points. We are processing your request.`,
      { reward_id: rewardId, reward_title: rewardTitle, points_earned: -pointsDeducted }
    );
  }
}