"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshTokenHandler = exports.login = exports.signup = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const password_1 = require("../utils/password");
const jwt_1 = require("../utils/jwt");
const crypto_1 = require("crypto");
// POST /api/v1/auth/signup
const signup = async (req, res) => {
    try {
        const { username, email, password, phone, region } = req.body;
        // Validations
        if (!email && !phone) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Email or phone required',
                    fields: { email: 'Email or phone must be provided' },
                },
            });
        }
        if (email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid email format',
                    fields: { email: 'Invalid email format' },
                },
            });
        }
        if (password && (password.length < 8 || !/\d/.test(password) || !/[A-Z]/.test(password))) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Password must be at least 8 chars with 1 digit and 1 uppercase',
                    fields: { password: 'Password policy not met' },
                },
            });
        }
        if (username && (username.length > 30 || !/^[a-zA-Z0-9_]+$/.test(username))) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Username must be 1-30 alphanumeric + underscore',
                    fields: { username: 'Invalid username format' },
                },
            });
        }
        // Check for existing user
        if (email) {
            const existingStmt = sqlite_1.default.prepare('SELECT id FROM users WHERE email = ?');
            const existing = existingStmt.get(email.toLowerCase());
            if (existing) {
                return res.status(409).json({
                    error: {
                        code: 'USER_EXISTS',
                        message: 'Email already registered',
                        fields: { email: 'This email is already in use' },
                    },
                });
            }
        }
        if (phone) {
            const existingStmt = sqlite_1.default.prepare('SELECT id FROM users WHERE phone = ?');
            const existing = existingStmt.get(phone);
            if (existing) {
                return res.status(409).json({
                    error: {
                        code: 'USER_EXISTS',
                        message: 'Phone already registered',
                        fields: { phone: 'This phone is already in use' },
                    },
                });
            }
        }
        if (username) {
            const existingStmt = sqlite_1.default.prepare('SELECT id FROM users WHERE username = ?');
            const existing = existingStmt.get(username);
            if (existing) {
                return res.status(409).json({
                    error: {
                        code: 'USER_EXISTS',
                        message: 'Username already taken',
                        fields: { username: 'This username is taken' },
                    },
                });
            }
        }
        // Hash password if provided
        const passwordHash = password ? await (0, password_1.hashPassword)(password) : undefined;
        // Create user
        const userId = (0, crypto_1.randomUUID)();
        const insertStmt = sqlite_1.default.prepare(`
      INSERT INTO users (
        id, username, email, phone, password_hash, region, auth_providers,
        civic_points, civic_level, trust_score, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
        insertStmt.run(userId, username || null, email ? email.toLowerCase() : null, phone || null, passwordHash || null, region ? JSON.stringify(region) : null, password ? JSON.stringify([{ provider: 'email', provider_id: email }]) : JSON.stringify([]), 0, // civic_points
        1, // civic_level
        0.5, // trust_score
        'active' // status
        );
        // Generate tokens
        const accessToken = (0, jwt_1.generateAccessToken)(userId, email || undefined);
        const refreshToken = (0, jwt_1.generateRefreshToken)(userId);
        return res.status(201).json({
            user: {
                id: userId,
                username: username,
                email: email,
                region: region,
                civicPoints: 0,
            },
            token: accessToken,
            refresh_token: refreshToken,
        });
    }
    catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Signup failed',
            },
        });
    }
};
exports.signup = signup;
// POST /api/v1/auth/login
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Email and password required',
                    fields: { email: 'Email required', password: 'Password required' },
                },
            });
        }
        const userStmt = sqlite_1.default.prepare('SELECT * FROM users WHERE email = ?');
        const user = userStmt.get(email.toLowerCase());
        if (!user || !user.password_hash) {
            return res.status(401).json({
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'Invalid email or password',
                },
            });
        }
        const passwordValid = await (0, password_1.verifyPassword)(password, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'Invalid email or password',
                },
            });
        }
        const accessToken = (0, jwt_1.generateAccessToken)(user.id, user.email || undefined);
        const refreshToken = (0, jwt_1.generateRefreshToken)(user.id);
        return res.status(200).json({
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                region: user.region ? JSON.parse(user.region) : null,
                civicPoints: user.civic_points,
            },
            token: accessToken,
            refresh_token: refreshToken,
        });
    }
    catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Login failed',
            },
        });
    }
};
exports.login = login;
// POST /api/v1/auth/refresh
const refreshTokenHandler = async (req, res) => {
    try {
        const { refresh_token } = req.body;
        if (!refresh_token) {
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Refresh token required',
                },
            });
        }
        const { verifyRefreshToken } = await Promise.resolve().then(() => __importStar(require('../utils/jwt')));
        const payload = verifyRefreshToken(refresh_token);
        if (!payload) {
            return res.status(401).json({
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'Invalid or expired refresh token',
                },
            });
        }
        const userStmt = sqlite_1.default.prepare('SELECT id, email FROM users WHERE id = ?');
        const user = userStmt.get(payload.sub);
        if (!user) {
            return res.status(401).json({
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'User not found',
                },
            });
        }
        const accessToken = (0, jwt_1.generateAccessToken)(user.id, user.email || undefined);
        return res.status(200).json({
            token: accessToken,
            refresh_token, // Return same refresh token
        });
    }
    catch (error) {
        console.error('Refresh token error:', error);
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Token refresh failed',
            },
        });
    }
};
exports.refreshTokenHandler = refreshTokenHandler;
