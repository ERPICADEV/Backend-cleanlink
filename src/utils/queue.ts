import redis from '../config/redis';

export const enqueueAIAnalysis = async (reportId: string) => {
  try {
    await redis.lpush('ai_processing_queue', reportId);
  } catch (error) {
    console.error('❌ Failed to queue AI analysis:', error);
  }
};

export const processAIQueue = async () => {
  try {
    const reportId = await redis.rpop('ai_processing_queue');
    if (reportId) {
      const { processReportWithAI } = await import('../workers/aiWorker');
      await processReportWithAI(reportId);
    }
  } catch (error) {
    console.error('❌ AI queue processing error:', error);
  }
};

// Start queue processor
setInterval(processAIQueue, 10000);