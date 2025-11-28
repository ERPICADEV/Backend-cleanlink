"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const crypto_1 = require("crypto");
class NotificationService {
    static async createNotification(userId, type, title, message, data) {
        try {
            const id = (0, crypto_1.randomUUID)();
            const stmt = sqlite_1.default.prepare(
            // Column names must match SQLite schema (config/sqlite.ts)
            'INSERT INTO notifications (id, user_id, type, title, message, data, created_at, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            const result = stmt.run(id, userId, type, title, message, JSON.stringify(data || {}), new Date().toISOString(), 0 // SQLite boolean: 0 = false, 1 = true
            );
            console.log(`📬 Notification created for user ${userId}: ${title}`);
            return { id, userId, type, title, message, data: data || {} };
        }
        catch (error) {
            console.error('Failed to create notification:', error);
            return null;
        }
    }
    // Common notification templates
    static async notifyReportResolved(userId, reportId, points, level) {
        return this.createNotification(userId, 'report_resolved', 'Report Resolved! 🎉', `Your garbage report has been cleaned by MCD. You earned ${points} civic points!`, { points_earned: points, report_id: reportId, new_level: level });
    }
    static async notifyLevelUp(userId, newLevel, levelName) {
        return this.createNotification(userId, 'level_up', 'Level Up! ⭐', `Congratulations! You've reached ${levelName} (Level ${newLevel})`, { new_level: newLevel });
    }
    static async notifyPointsEarned(userId, points, reason) {
        return this.createNotification(userId, 'points_earned', 'Points Earned! 💰', `You earned ${points} points for ${reason}`, { points_earned: points });
    }
    static async notifyNewComment(reportOwnerId, reportId, commenterName, snippet) {
        const displayName = commenterName || 'Someone';
        return this.createNotification(reportOwnerId, 'comment_new', 'New comment on your report 💬', `${displayName} commented on your report: "${snippet}"`, { report_id: reportId });
    }
    static async notifyVote(reportOwnerId, reportId, voteValue) {
        const isUpvote = voteValue === 1;
        return this.createNotification(reportOwnerId, 'vote_cast', isUpvote ? 'Your report got an upvote 👍' : 'Your report got a downvote 👎', isUpvote
            ? 'Someone upvoted your civic report.'
            : 'Someone downvoted your civic report.', { report_id: reportId });
    }
    static async notifyRewardRedeemed(userId, rewardId, rewardTitle, pointsDeducted) {
        return this.createNotification(userId, 'reward_redeemed', 'Reward redemption requested 🎁', `You redeemed "${rewardTitle}" for ${pointsDeducted} points. We are processing your request.`, { reward_id: rewardId, reward_title: rewardTitle, points_earned: -pointsDeducted });
    }
}
exports.NotificationService = NotificationService;
