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
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueAIAnalysis = void 0;
const redis_1 = require("../config/redis");
const enqueueAIAnalysis = async (reportId) => {
    try {
        await redis_1.redis.lpush('ai_processing_queue', reportId);
        console.log('📥 Queued AI analysis for report:', reportId);
    }
    catch (error) {
        console.error('❌ Failed to queue AI analysis:', error);
    }
};
exports.enqueueAIAnalysis = enqueueAIAnalysis;
// Start queue processor - handle both cases: Redis already ready or not yet ready
const startQueueProcessor = () => {
    console.log("⚙️ Starting AI Queue Processor...");
    // Process queue periodically (shorter interval for more responsive MVP)
    setInterval(async () => {
        try {
            const task = await redis_1.redis.rpop("ai_processing_queue");
            if (!task)
                return;
            console.log("Processing AI task:", task);
            // Process the task with existing AI logic
            const { processReportWithAI } = await Promise.resolve().then(() => __importStar(require('../workers/aiWorker')));
            await processReportWithAI(task);
        }
        catch (err) {
            console.error("❌ AI queue processing error:", err);
        }
    }, 3000);
};
// Check if Redis is already ready, otherwise wait for ready event
if (redis_1.redis.status === 'ready') {
    startQueueProcessor();
}
else {
    redis_1.redis.once("ready", () => {
        startQueueProcessor();
    });
}
