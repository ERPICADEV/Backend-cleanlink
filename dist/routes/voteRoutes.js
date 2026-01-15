"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const voteController_1 = require("../controllers/voteController");
const auth_1 = require("../middleware/auth");
const rateLimiter_1 = require("../middleware/rateLimiter");
const router = (0, express_1.Router)();
router.post('/:id/vote', auth_1.authMiddleware, rateLimiter_1.authenticatedLimiter, voteController_1.voteReport);
exports.default = router;
