"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const commentController_sqlite_1 = require("../controllers/commentController-sqlite");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// SQLite endpoints
router.post('/:id/comments', auth_1.authMiddleware, commentController_sqlite_1.createComment);
router.get('/:id/comments', commentController_sqlite_1.getComments);
router.patch('/comments/:id', auth_1.authMiddleware, commentController_sqlite_1.updateComment);
router.delete('/comments/:id', auth_1.authMiddleware, commentController_sqlite_1.deleteComment);
exports.default = router;
