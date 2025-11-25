"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const dotenv_1 = __importDefault(require("dotenv"));
const database_1 = __importDefault(require("./config/database"));
const redis_1 = __importDefault(require("./config/redis"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get('/health', async (req, res) => {
    try {
        // Test DB connection
        await database_1.default.$queryRaw `SELECT 1`;
        // Test Redis connection
        await redis_1.default.ping();
        res.json({
            status: 'ok',
            service: 'cleanlink-api',
            database: 'connected',
            redis: 'connected'
        });
    }
    catch (error) {
        res.status(503).json({
            status: 'error',
            service: 'cleanlink-api',
            error: 'Service unavailable'
        });
    }
});
app.listen(PORT, () => {
    console.log(`🚀 CleanLink API running on port ${PORT}`);
});
