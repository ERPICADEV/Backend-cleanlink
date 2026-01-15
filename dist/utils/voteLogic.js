"use strict";
/**
 * Shared vote calculation utilities
 * Implements Reddit-style voting: click same button = remove vote, click opposite = change vote
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateVoteChange = calculateVoteChange;
exports.calculateCommunityScore = calculateCommunityScore;
exports.isValidVoteValue = isValidVoteValue;
/**
 * Calculate new vote state when user votes
 * @param currentState Current vote counts and user's vote
 * @param voteValue The vote value the user is trying to cast (1 for upvote, -1 for downvote)
 * @returns New vote state after applying the vote
 */
function calculateVoteChange(currentState, voteValue) {
    const { upvotes, downvotes, userVote } = currentState;
    // Reddit-style behavior:
    // - If clicking the same button you already clicked → remove vote (set to 0)
    // - If clicking the opposite button → change vote
    // - If no vote exists → add new vote
    if (userVote === voteValue) {
        // User clicked the same button → remove vote
        return {
            newUpvotes: Math.max(0, upvotes - (voteValue === 1 ? 1 : 0)),
            newDownvotes: Math.max(0, downvotes - (voteValue === -1 ? 1 : 0)),
            newUserVote: 0,
        };
    }
    else if (userVote !== 0) {
        // User clicked opposite button → change vote
        // Remove old vote
        const afterRemove = {
            upvotes: userVote === 1 ? Math.max(0, upvotes - 1) : upvotes,
            downvotes: userVote === -1 ? Math.max(0, downvotes - 1) : downvotes,
        };
        // Add new vote
        return {
            newUpvotes: voteValue === 1 ? afterRemove.upvotes + 1 : afterRemove.upvotes,
            newDownvotes: voteValue === -1 ? afterRemove.downvotes + 1 : afterRemove.downvotes,
            newUserVote: voteValue,
        };
    }
    else {
        // No existing vote → add new vote
        return {
            newUpvotes: voteValue === 1 ? upvotes + 1 : upvotes,
            newDownvotes: voteValue === -1 ? downvotes + 1 : downvotes,
            newUserVote: voteValue,
        };
    }
}
/**
 * Calculate community score from vote counts
 */
function calculateCommunityScore(upvotes, downvotes) {
    const total = upvotes + downvotes;
    if (total === 0)
        return 0;
    return (upvotes - downvotes) / total;
}
/**
 * Validate vote value
 */
function isValidVoteValue(value) {
    return value === 1 || value === -1;
}
