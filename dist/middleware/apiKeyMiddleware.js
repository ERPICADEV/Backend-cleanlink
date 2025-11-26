"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyMiddleware = void 0;
const apiKeyMiddleware = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    // For development/testing, accept ANY API key or use a simple one
    // Remove this in production!
    if (process.env.NODE_ENV === 'development') {
        console.log('API Key received:', apiKey);
        return next(); // Allow all requests in development
    }
    // In production, you would validate against a stored key
    const expectedKey = process.env.AI_SERVICE_API_KEY || 'cleanlink-ai-key-2024';
    if (!apiKey) {
        return res.status(401).json({
            error: {
                code: 'UNAUTHORIZED',
                message: 'API key required in X-API-Key header',
            },
        });
    }
    // For now, accept any non-empty API key for testing
    if (apiKey && apiKey.toString().trim().length > 0) {
        return next();
    }
    return res.status(401).json({
        error: {
            code: 'UNAUTHORIZED',
            message: 'Valid API key required',
        },
    });
};
exports.apiKeyMiddleware = apiKeyMiddleware;
