"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.commentAuthorMiddleware = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const commentAuthorMiddleware = async (req, res, next) => {
    try {
        const { id } = req.params; // comment id
        const stmt = sqlite_1.default.prepare('SELECT authorId FROM comments WHERE id = ?');
        const comment = stmt.get(id);
        if (!comment) {
            return res.status(404).json({
                error: { code: 'NOT_FOUND', message: 'Comment not found' },
            });
        }
        // Check if user is the comment author
        if (comment.authorId !== req.userId) {
            return res.status(403).json({
                error: { code: 'FORBIDDEN', message: 'Not authorized to modify this comment' },
            });
        }
        next();
    }
    catch (error) {
        console.error('Comment author middleware error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Authorization check failed' },
        });
    }
};
exports.commentAuthorMiddleware = commentAuthorMiddleware;
