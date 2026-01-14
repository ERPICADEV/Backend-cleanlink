import { redis } from '../config/redis';

export const enqueueAIAnalysis = async (reportId: string) => {
  try {
    await redis.lpush('ai_processing_queue', reportId);
    console.log('📥 Queued AI analysis for report:', reportId);
  } catch (error) {
    console.error('❌ Failed to queue AI analysis:', error);
  }
};

// Start queue processor - handle both cases: Redis already ready or not yet ready
const startQueueProcessor = () => {
  console.log("⚙️ Starting AI Queue Processor...");

  // Process queue periodically (shorter interval for more responsive MVP)
  setInterval(async () => {
    try {
      const task = await redis.rpop("ai_processing_queue");
      if (!task) return;

      console.log("Processing AI task:", task);

      // Process the task with existing AI logic
      const { processReportWithAI } = await import('../workers/aiWorker');
      await processReportWithAI(task);
    } catch (err) {
      console.error("❌ AI queue processing error:", err);
    }
  }, 3000);
};

// Check if Redis is already ready, otherwise wait for ready event
if (redis.status === 'ready') {
  startQueueProcessor();
} else {
  redis.once("ready", () => {
    startQueueProcessor();
  });
}