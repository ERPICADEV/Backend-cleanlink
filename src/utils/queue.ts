import { redis } from '../config/redis';

export const enqueueAIAnalysis = async (reportId: string) => {
  try {
    await redis.lpush('ai_processing_queue', reportId);
  } catch (error) {
    console.error('❌ Failed to queue AI analysis:', error);
  }
};

// Start queue processor only after Redis is ready
redis.once("ready", () => {
  console.log("⚙️ Starting AI Queue Processor...");

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
  }, 10000); // Keep 10 second interval as before
});