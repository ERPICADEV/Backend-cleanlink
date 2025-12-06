"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommentVote = exports.voteComment = void 0;
const postgres_1 = require("../config/postgres");
const crypto_1 = require("crypto");
// POST /api/v1/comments/:id/vote
const voteComment = async (req, res) => {
    const startTime = Date.now();
    try {
        const { id: commentId } = req.params;
        const { value } = req.body;
        const userId = req.userId;
        const voteValue = typeof value === 'string' ? parseInt(value) : value;
        if (voteValue !== 1 && voteValue !== -1) {
            return res.status(400).json({ error: 'Invalid vote value' });
        }
        // Transaction for atomic operations
        const client = await postgres_1.pool.connect();
        let finalUserVote = voteValue;
        try {
            await client.query('BEGIN');
            // 1. Get comment
            const commentResult = await client.query('SELECT upvotes, downvotes, author_id FROM comments WHERE id = $1', [commentId]);
            const comment = commentResult.rows[0];
            if (!comment) {
                throw new Error('COMMENT_NOT_FOUND');
            }
            const { upvotes, downvotes } = comment;
            // 2. Check existing vote
            const voteResult = await client.query('SELECT value FROM comment_votes WHERE comment_id = $1 AND user_id = $2', [commentId, userId]);
            const existingVote = voteResult.rows[0];
            let userVote = voteValue;
            let newUpvotes = upvotes;
            let newDownvotes = downvotes;
            // 3. Handle vote logic
            if (existingVote) {
                if (existingVote.value === voteValue) {
                    // User clicked the same vote button - toggle off (remove vote, set to 0)
                    await client.query('DELETE FROM comment_votes WHERE comment_id = $1 AND user_id = $2', [commentId, userId]);
                    // Remove the vote from counts
                    if (voteValue === 1) {
                        newUpvotes = Math.max(0, upvotes - 1);
                        newDownvotes = downvotes;
                    }
                    else {
                        newUpvotes = upvotes;
                        newDownvotes = Math.max(0, downvotes - 1);
                    }
                    userVote = 0;
                }
                else {
                    // Change vote
                    await client.query('UPDATE comment_votes SET value = $1 WHERE comment_id = $2 AND user_id = $3', [voteValue, commentId, userId]);
                    // Remove old vote from counts
                    if (existingVote.value === 1) {
                        newUpvotes = Math.max(0, upvotes - 1);
                    }
                    else {
                        newDownvotes = Math.max(0, downvotes - 1);
                    }
                    // Add new vote to counts
                    if (voteValue === 1) {
                        newUpvotes = newUpvotes + 1;
                    }
                    else {
                        newDownvotes = newDownvotes + 1;
                    }
                    userVote = voteValue;
                }
            }
            else {
                // New vote
                await client.query('INSERT INTO comment_votes (id, comment_id, user_id, value) VALUES ($1, $2, $3, $4)', [(0, crypto_1.randomUUID)(), commentId, userId, voteValue]);
                newUpvotes = voteValue === 1 ? upvotes + 1 : upvotes;
                newDownvotes = voteValue === -1 ? downvotes + 1 : downvotes;
                userVote = voteValue;
            }
            // 4. Update comment vote counts
            await client.query('UPDATE comments SET upvotes = $1, downvotes = $2 WHERE id = $3', [newUpvotes, newDownvotes, commentId]);
            await client.query('COMMIT');
            const processingTime = Date.now() - startTime;
            finalUserVote = userVote;
            res.json({
                comment_id: commentId,
                upvotes: newUpvotes,
                downvotes: newDownvotes,
                user_vote: userVote,
                processing_time: processingTime
            });
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    catch (error) {
        console.error(`❌ Comment vote failed after ${Date.now() - startTime}ms:`, error);
        if (error.message === 'COMMENT_NOT_FOUND') {
            return res.status(404).json({ error: 'Comment not found' });
        }
        res.status(500).json({ error: 'Failed to process comment vote' });
    }
};
exports.voteComment = voteComment;
// GET /api/v1/comments/:id/vote - Get user's vote on a comment
const getCommentVote = async (req, res) => {
    try {
        const { id: commentId } = req.params;
        const userId = req.userId;
        if (!userId) {
            return res.status(200).json({ user_vote: 0 });
        }
        const result = await postgres_1.pool.query('SELECT value FROM comment_votes WHERE comment_id = $1 AND user_id = $2', [commentId, userId]);
        const vote = result.rows[0];
        return res.status(200).json({
            user_vote: vote?.value || 0
        });
    }
    catch (error) {
        console.error('Get comment vote error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch comment vote' },
        });
    }
};
exports.getCommentVote = getCommentVote;
