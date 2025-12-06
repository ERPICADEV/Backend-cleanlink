"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const rewardController_sqlite_1 = require("../controllers/rewardController-sqlite");
const auth_1 = require("../middleware/auth");
const adminMiddleware_1 = require("../middleware/adminMiddleware");
const router = (0, express_1.Router)();
// SQLite endpoints
// Public endpoint - returns only available rewards
router.get('/', rewardController_sqlite_1.getRewards);
// Admin endpoint - returns all rewards (including unavailable)
router.get('/admin/all', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, (0, adminMiddleware_1.requirePermission)('MANAGE_REWARDS'), rewardController_sqlite_1.getAllRewards);
router.post('/:id/redeem', auth_1.authMiddleware, rewardController_sqlite_1.redeemReward);
// CRUD endpoints - require MANAGE_REWARDS permission (superadmin only)
router.post('/', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, (0, adminMiddleware_1.requirePermission)('MANAGE_REWARDS'), rewardController_sqlite_1.createReward);
router.patch('/:id', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, (0, adminMiddleware_1.requirePermission)('MANAGE_REWARDS'), rewardController_sqlite_1.updateReward);
router.delete('/:id', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, (0, adminMiddleware_1.requirePermission)('MANAGE_REWARDS'), rewardController_sqlite_1.deleteReward);
exports.default = router;
