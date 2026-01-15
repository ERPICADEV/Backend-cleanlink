"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const reportController_1 = require("../controllers/reportController");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.get('/', reportController_1.getReports);
router.post('/', auth_1.authMiddleware, reportController_1.createReport);
router.post('/pre-submission-suggestions', reportController_1.getPreSubmissionSuggestions); // No auth required - optional suggestions
router.get('/:id', reportController_1.getReport);
router.patch('/:id', auth_1.authMiddleware, reportController_1.updateReport);
exports.default = router;
