import prisma from '../config/database';
import { AIService, ReportForAnalysis } from '../services/aiService';

const apiKey = process.env.OPENROUTER_API_KEY;
const aiService = new AIService(apiKey || '');

// Add retry function for database queries
const retryQuery = async (query: () => Promise<any>, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await query();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Retrying database query (attempt ${i + 1})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
};

export const processReportWithAI = async (reportId: string) => {
  try {
    console.log(`Processing report ${reportId} with AI...`);
    
    if (!apiKey) {
      console.error('❌ Cannot process AI - API key missing');
      return;
    }

    // Use retry for database queries
    const report = await retryQuery(() => 
      prisma.report.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          title: true,
          description: true,
          images: true,
          location: true,
          category: true,
        },
      })
    );

    if (!report) {
      console.error(`Report ${reportId} not found`);
      return;
    }

    // Prepare data for AI analysis
    const reportData: ReportForAnalysis = {
      title: report.title,
      description: report.description,
      images: Array.isArray(report.images) ? report.images : [],
      location: report.location,
      category: report.category,
    };

    console.log('🤖 Calling AI service...');
    const aiResult = await aiService.analyzeReport(reportData);
    console.log('✅ AI analysis result:', aiResult);

    // Update report with AI results using retry
    await retryQuery(() =>
      prisma.report.update({
        where: { id: reportId },
        data: {
          aiScore: {
            legit: aiResult.legit,
            severity: aiResult.severity,
            duplicate_prob: aiResult.duplicate_prob,
            insights: aiResult.insights,
            processed_at: new Date().toISOString(),
          },
          status: aiResult.legit > 0.7 ? 'community_verified' : 
                  aiResult.legit < 0.3 ? 'flagged' : 'pending',
        },
      })
    );

    console.log(`✅ AI processing complete for report ${reportId}`);
    
  } catch (error) {
    console.error(`❌ AI processing failed for report ${reportId}:`, error);
  }
};