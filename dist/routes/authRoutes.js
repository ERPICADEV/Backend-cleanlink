"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_sqlite_1 = require("../controllers/authController-sqlite");
const router = (0, express_1.Router)();
// SQLite endpoints
router.post('/signup', authController_sqlite_1.signup);
router.post('/login', authController_sqlite_1.login);
router.post('/refresh', authController_sqlite_1.refreshTokenHandler);
exports.default = router;
