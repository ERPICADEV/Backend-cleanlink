"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processReportWithAI = void 0;
const postgres_1 = require("../config/postgres");
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
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
};
const processReportWithAI = async (reportId) => {
    try {
        if (!apiKey) {
            console.error('❌ Cannot process AI - OPENROUTER_API_KEY is missing from .env file');
            console.error('   Please add OPENROUTER_API_KEY=your_key_here to your .env file');
            return;
        }
        if (!apiKey.startsWith('sk-or-v1-')) {
            console.warn('⚠️  Warning: OPENROUTER_API_KEY format may be incorrect (should start with "sk-or-v1-")');
        }
        // Use retry for database queries
        const report = await retryQuery(async () => {
            const result = await postgres_1.pool.query(`
        SELECT 
          id, 
          title, 
          description, 
          images, 
          location, 
          category
        FROM reports
        WHERE id = $1
      `, [reportId]);
            return result.rows[0];
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
        const aiResult = await aiService.analyzeReport(reportData);
        // Only save AI analysis if it was successful
        if (!aiResult.success) {
            console.error(`❌ AI analysis failed for report ${reportId} - NOT saving fake data to database`);
            console.error('   Fix your OPENROUTER_API_KEY to get real AI analysis');
            return;
        }
        // Update report with AI results using retry
        await retryQuery(async () => {
            const newStatus = aiResult.legit > 0.7 ? 'community_verified' :
                aiResult.legit < 0.3 ? 'flagged' : 'pending';
            const aiScoreData = {
                legit: aiResult.legit,
                severity: aiResult.severity,
                duplicate_prob: aiResult.duplicate_prob,
                insights: aiResult.insights,
                processed_at: new Date().toISOString(),
            };
            await postgres_1.pool.query(`
        UPDATE reports 
        SET 
          ai_score = $1,
          status = $2,
          updated_at = $3
        WHERE id = $4
      `, [
                JSON.stringify(aiScoreData),
                newStatus,
                new Date().toISOString(),
                reportId
            ]);
        });
    }
    catch (error) {
        console.error(`❌ AI processing failed for report ${reportId}:`, error);
    }
};
exports.processReportWithAI = processReportWithAI;
