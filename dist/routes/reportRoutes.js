"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const reportController_sqlite_1 = require("../controllers/reportController-sqlite"); // New SQLite versions
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// SQLite endpoints
router.get('/', reportController_sqlite_1.getReports);
router.post('/', auth_1.authMiddleware, reportController_sqlite_1.createReport);
router.get('/:id', reportController_sqlite_1.getReport);
router.patch('/:id', auth_1.authMiddleware, reportController_sqlite_1.updateReport);
exports.default = router;
