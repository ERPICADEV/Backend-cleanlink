"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.voteReport = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const crypto_1 = require("crypto");
const notificationService_1 = require("../services/notificationService");
const voteReport = async (req, res) => {
    const startTime = Date.now();
    try {
        const { id } = req.params;
        const { value } = req.body;
        const userId = req.userId;
        const voteValue = typeof value === 'string' ? parseInt(value) : value;
        if (voteValue !== 1 && voteValue !== -1) {
            return res.status(400).json({ error: 'Invalid vote value' });
        }
        console.log('🔍 Starting SQLite vote...');
        // Prepare statements with proper typing
        const getReportStmt = sqlite_1.default.prepare('SELECT upvotes, downvotes, reporter_id FROM reports WHERE id = ?');
        const getVoteStmt = sqlite_1.default.prepare('SELECT value FROM votes WHERE report_id = ? AND user_id = ?');
        const deleteVoteStmt = sqlite_1.default.prepare('DELETE FROM votes WHERE report_id = ? AND user_id = ?');
        const updateVoteStmt = sqlite_1.default.prepare('UPDATE votes SET value = ? WHERE report_id = ? AND user_id = ?');
        const insertVoteStmt = sqlite_1.default.prepare('INSERT INTO votes (id, report_id, user_id, value) VALUES (?, ?, ?, ?)');
        const updateReportStmt = sqlite_1.default.prepare('UPDATE reports SET upvotes = ?, downvotes = ?, community_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        // Transaction for atomic operations
        let reportOwnerId = null;
        let finalUserVote = voteValue;
        sqlite_1.default.transaction(() => {
            // 1. Get report with type assertion
            const report = getReportStmt.get(id);
            if (!report) {
                throw new Error('REPORT_NOT_FOUND');
            }
            const { upvotes, downvotes, reporter_id } = report;
            reportOwnerId = reporter_id || null;
            // 2. Check existing vote with type assertion
            const existingVote = getVoteStmt.get(id, userId);
            let userVote = voteValue;
            let newUpvotes = upvotes;
            let newDownvotes = downvotes;
            // 3. Handle vote logic
            if (existingVote) {
                if (existingVote.value === voteValue) {
                    // Remove vote
                    deleteVoteStmt.run(id, userId);
                    userVote = 0;
                    newUpvotes = voteValue === 1 ? upvotes - 1 : upvotes;
                    newDownvotes = voteValue === -1 ? downvotes - 1 : downvotes;
                }
                else {
                    // Change vote
                    updateVoteStmt.run(voteValue, id, userId);
                    newUpvotes = voteValue === 1 ? upvotes + 1 : upvotes - 1;
                    newDownvotes = voteValue === -1 ? downvotes + 1 : downvotes - 1;
                }
            }
            else {
                // New vote
                insertVoteStmt.run((0, crypto_1.randomUUID)(), id, userId, voteValue);
                newUpvotes = voteValue === 1 ? upvotes + 1 : upvotes;
                newDownvotes = voteValue === -1 ? downvotes + 1 : downvotes;
            }
            // 4. Calculate score and update report
            const communityScore = (newUpvotes - newDownvotes) / Math.max(1, newUpvotes + newDownvotes);
            updateReportStmt.run(newUpvotes, newDownvotes, communityScore, id);
            const processingTime = Date.now() - startTime;
            console.log(`⚡ SQLite vote processed in ${processingTime}ms`);
            finalUserVote = userVote;
            res.json({
                report_id: id,
                upvotes: newUpvotes,
                downvotes: newDownvotes,
                score: communityScore,
                user_vote: userVote,
                processing_time: processingTime
            });
        })();
        // Send notification outside of transaction (fire-and-forget)
        if (reportOwnerId && reportOwnerId !== userId && finalUserVote !== 0) {
            notificationService_1.NotificationService.notifyVote(reportOwnerId, id, finalUserVote);
        }
    }
    catch (error) {
        console.error(`❌ Vote failed after ${Date.now() - startTime}ms:`, error);
        if (error.message === 'REPORT_NOT_FOUND') {
            return res.status(404).json({ error: 'Report not found' });
        }
        res.status(500).json({ error: 'Failed to process vote' });
    }
};
exports.voteReport = voteReport;
