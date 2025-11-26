"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const rewardController_sqlite_1 = require("../controllers/rewardController-sqlite");
const auth_1 = require("../middleware/auth");
const adminMiddleware_1 = require("../middleware/adminMiddleware");
const router = (0, express_1.Router)();
// SQLite endpoints
router.get('/', rewardController_sqlite_1.getRewards);
router.post('/:id/redeem', auth_1.authMiddleware, rewardController_sqlite_1.redeemReward);
router.post('/', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, rewardController_sqlite_1.createReward);
router.patch('/:id', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, rewardController_sqlite_1.updateReward);
router.delete('/:id', auth_1.authMiddleware, adminMiddleware_1.adminMiddleware, rewardController_sqlite_1.deleteReward);
exports.default = router;
