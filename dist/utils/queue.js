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
exports.processAIQueue = exports.enqueueAIAnalysis = void 0;
const redis_1 = __importDefault(require("../config/redis"));
const enqueueAIAnalysis = async (reportId) => {
    try {
        await redis_1.default.lpush('ai_processing_queue', reportId);
        console.log(`✅ Queued report ${reportId} for AI analysis`);
        console.log(`📊 Queue length: ${await redis_1.default.llen('ai_processing_queue')}`);
    }
    catch (error) {
        console.error('❌ Failed to queue AI analysis:', error);
    }
};
exports.enqueueAIAnalysis = enqueueAIAnalysis;
const processAIQueue = async () => {
    try {
        const reportId = await redis_1.default.rpop('ai_processing_queue');
        if (reportId) {
            console.log(`🎯 Processing queued report: ${reportId}`);
            const { processReportWithAI } = await Promise.resolve().then(() => __importStar(require('../workers/aiWorker')));
            await processReportWithAI(reportId);
        }
        else {
        }
    }
    catch (error) {
        console.error('❌ AI queue processing error:', error);
    }
};
exports.processAIQueue = processAIQueue;
// Start queue processor
console.log('🚀 AI Queue processor started');
setInterval(exports.processAIQueue, 10000);
