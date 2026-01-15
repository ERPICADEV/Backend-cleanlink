"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const aiController_1 = require("../controllers/aiController");
const router = (0, express_1.Router)();
router.post('/reports/:id/result', aiController_1.updateAIResult);
router.get('/reports/pending', aiController_1.getPendingAIReports);
exports.default = router;
