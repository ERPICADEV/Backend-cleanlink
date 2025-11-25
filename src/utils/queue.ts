import redis from '../config/redis';

export const enqueueAIAnalysis = async (reportId: string) => {
  try {
    await redis.lpush('ai_processing_queue', reportId);
    console.log(`✅ Queued report ${reportId} for AI analysis`);
    console.log(`📊 Queue length: ${await redis.llen('ai_processing_queue')}`);
  } catch (error) {
    console.error('❌ Failed to queue AI analysis:', error);
  }
};

export const processAIQueue = async () => {
  try {
    console.log('🔄 Checking AI queue...');
    const reportId = await redis.rpop('ai_processing_queue');
    if (reportId) {
      console.log(`🎯 Processing queued report: ${reportId}`);
      const { processReportWithAI } = await import('../workers/aiWorker');
      await processReportWithAI(reportId);
    } else {
      console.log('📭 AI queue is empty');
    }
  } catch (error) {
    console.error('❌ AI queue processing error:', error);
  }
};

// Start queue processor
console.log('🚀 AI Queue processor started');
setInterval(processAIQueue, 10000);