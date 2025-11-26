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
            const stmt = sqlite_1.default.prepare('INSERT INTO notifications (id, userId, type, title, message, data, createdAt, isRead) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            const result = stmt.run(id, userId, type, title, message, JSON.stringify(data || {}), new Date().toISOString(), false);
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
}
exports.NotificationService = NotificationService;
