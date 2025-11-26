"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const userController_sqlite_1 = require("../controllers/userController-sqlite");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// SQLite endpoints
router.get('/me', auth_1.authMiddleware, userController_sqlite_1.getMe);
router.patch('/me', auth_1.authMiddleware, userController_sqlite_1.updateMe);
router.get('/:id/public', userController_sqlite_1.getPublicProfile);
router.get('/regions', userController_sqlite_1.getRegions);
router.patch('/me/region', auth_1.authMiddleware, userController_sqlite_1.updateRegion);
exports.default = router;
