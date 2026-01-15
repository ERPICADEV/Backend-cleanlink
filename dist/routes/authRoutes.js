"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_1 = require("../controllers/authController");
const router = (0, express_1.Router)();
// POST routes
router.post('/signup', authController_1.signup);
router.post('/login', authController_1.login);
router.post('/refresh', authController_1.refreshTokenHandler);
router.post('/google', authController_1.googleAuth);
router.get('/google/client-id', authController_1.getGoogleClientId);
// Handle GET requests to auth routes with helpful error message
router.get('/signup', (req, res) => {
    res.status(405).json({
        error: {
            code: 'METHOD_NOT_ALLOWED',
            message: 'Signup endpoint requires POST method. Use POST /api/v1/auth/signup',
            method: 'POST',
            endpoint: '/api/v1/auth/signup'
        }
    });
});
router.get('/login', (req, res) => {
    res.status(405).json({
        error: {
            code: 'METHOD_NOT_ALLOWED',
            message: 'Login endpoint requires POST method. Use POST /api/v1/auth/login',
            method: 'POST',
            endpoint: '/api/v1/auth/login'
        }
    });
});
exports.default = router;
