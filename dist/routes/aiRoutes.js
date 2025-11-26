"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const aiController_sqlite_1 = require("../controllers/aiController-sqlite");
const router = (0, express_1.Router)();
// SQLite endpoints
router.post('/reports/:id/result', aiController_sqlite_1.updateAIResult);
router.get('/reports/pending', aiController_sqlite_1.getPendingAIReports);
exports.default = router;
