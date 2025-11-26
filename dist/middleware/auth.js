"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuthMiddleware = exports.authMiddleware = void 0;
const jwt_1 = require("../utils/jwt");
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: {
                code: 'UNAUTHORIZED',
                message: 'Missing or invalid authorization header',
            },
        });
    }
    const token = authHeader.substring(7);
    const payload = (0, jwt_1.verifyAccessToken)(token);
    if (!payload) {
        return res.status(401).json({
            error: {
                code: 'UNAUTHORIZED',
                message: 'Invalid or expired token',
            },
        });
    }
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
};
exports.authMiddleware = authMiddleware;
const optionalAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const payload = (0, jwt_1.verifyAccessToken)(token);
        if (payload) {
            req.userId = payload.sub;
            req.userEmail = payload.email;
        }
    }
    next();
};
exports.optionalAuthMiddleware = optionalAuthMiddleware;
