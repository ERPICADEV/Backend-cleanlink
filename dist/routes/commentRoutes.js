"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const commentController_sqlite_1 = require("../controllers/commentController-sqlite");
const commentVoteController_sqlite_1 = require("../controllers/commentVoteController-sqlite");
const auth_1 = require("../middleware/auth");
const rateLimiter_1 = require("../middleware/rateLimiter");
const router = (0, express_1.Router)();
// SQLite endpoints
router.post('/:id/comments', auth_1.authMiddleware, commentController_sqlite_1.createComment);
router.get('/:id/comments', auth_1.optionalAuthMiddleware, commentController_sqlite_1.getComments);
router.patch('/comments/:id', auth_1.authMiddleware, commentController_sqlite_1.updateComment);
router.delete('/comments/:id', auth_1.authMiddleware, commentController_sqlite_1.deleteComment);
// Comment voting endpoints
router.post('/comments/:id/vote', auth_1.authMiddleware, rateLimiter_1.authenticatedLimiter, commentVoteController_sqlite_1.voteComment);
router.get('/comments/:id/vote', auth_1.authMiddleware, commentVoteController_sqlite_1.getCommentVote);
exports.default = router;
