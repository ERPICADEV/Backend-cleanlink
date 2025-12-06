"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const notificationController_sqlite_1 = require("../controllers/notificationController-sqlite");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// SQLite endpoints
router.get('/', auth_1.authMiddleware, notificationController_sqlite_1.getNotifications);
router.get('/unread-count', auth_1.authMiddleware, notificationController_sqlite_1.getUnreadCount);
router.patch('/:id/read', auth_1.authMiddleware, notificationController_sqlite_1.markAsRead);
exports.default = router;
