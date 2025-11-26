"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processReportWithAI = void 0;
const sqlite_1 = __importDefault(require("../config/sqlite"));
const aiService_1 = require("../services/aiService");
const apiKey = process.env.OPENROUTER_API_KEY;
const aiService = new aiService_1.AIService(apiKey || '');
// Add retry function for database queries
const retryQuery = async (query, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await query();
        }
        catch (error) {
            if (i === maxRetries - 1)
                throw error;
            console.log(`Retrying database query (attempt ${i + 1})...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
};
const processReportWithAI = async (reportId) => {
    try {
        console.log(`Processing report ${reportId} with AI...`);
        if (!apiKey) {
            console.error('❌ Cannot process AI - API key missing');
            return;
        }
        // Use retry for database queries
        const report = await retryQuery(() => {
            const stmt = sqlite_1.default.prepare(`
        SELECT 
          id, 
          title, 
          description, 
          images, 
          location, 
          category
        FROM reports
        WHERE id = ?
      `);
            return stmt.get(reportId);
        });
        if (!report) {
            console.error(`Report ${reportId} not found`);
            return;
        }
        // Prepare data for AI analysis
        let images = [];
        try {
            images = Array.isArray(report.images) ? report.images : JSON.parse(report.images || '[]');
        }
        catch {
            images = [];
        }
        let location = {};
        try {
            location = typeof report.location === 'string' ? JSON.parse(report.location) : report.location;
        }
        catch {
            location = {};
        }
        const reportData = {
            title: report.title,
            description: report.description,
            images,
            location,
            category: report.category,
        };
        console.log('🤖 Calling AI service...');
        const aiResult = await aiService.analyzeReport(reportData);
        console.log('✅ AI analysis result:', aiResult);
        // Update report with AI results using retry
        await retryQuery(() => {
            const stmt = sqlite_1.default.prepare(`
        UPDATE reports 
        SET 
          aiScore = ?,
          status = ?,
          updatedAt = ?
        WHERE id = ?
      `);
            const newStatus = aiResult.legit > 0.7 ? 'community_verified' :
                aiResult.legit < 0.3 ? 'flagged' : 'pending';
            const aiScoreData = {
                legit: aiResult.legit,
                severity: aiResult.severity,
                duplicate_prob: aiResult.duplicate_prob,
                insights: aiResult.insights,
                processed_at: new Date().toISOString(),
            };
            return Promise.resolve(stmt.run(JSON.stringify(aiScoreData), newStatus, new Date().toISOString(), reportId));
        });
        console.log(`✅ AI processing complete for report ${reportId}`);
    }
    catch (error) {
        console.error(`❌ AI processing failed for report ${reportId}:`, error);
    }
};
exports.processReportWithAI = processReportWithAI;
