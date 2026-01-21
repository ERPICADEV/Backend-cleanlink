// Defensive: ensure env is loaded even if this module is imported outside `src/index.ts`
import dotenv from 'dotenv'
dotenv.config()

import { pool } from '../config/postgres'
import { AIService, ReportForAnalysis } from '../services/aiService'

// MVP: enable vision insights when using a vision-capable model
const ENABLE_VISION_AI = true

// Add retry function for database queries
const retryQuery = async (query: () => Promise<any>, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await query()
    } catch (error) {
      if (i === maxRetries - 1) throw error
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

/**
 * Apply image-based heuristics to improve legitimacy score
 * - Multiple images boost credibility
 * - GPS matching between image EXIF and report location boosts credibility
 */
function applyImageHeuristics(
  legit: number,
  images: any[],
  reportLocation: any
): { adjustedLegit: number; heuristicAdjustments: string[] } {
  let adjustedLegit = legit
  const adjustments: string[] = []

  // Image count bonuses (never negative penalties)
  if (images.length >= 4) {
    adjustedLegit = Math.min(1.0, adjustedLegit + 0.1)
    adjustments.push('multiple_images_bonus')
  } else if (images.length >= 2) {
    adjustedLegit = Math.min(1.0, adjustedLegit + 0.05)
    adjustments.push('multiple_images_bonus')
  }

  // GPS matching heuristic (if image has GPS and it roughly matches report location)
  // Note: This is a placeholder - actual EXIF extraction would need a library
  // For now, we check if images have any location metadata
  if (images.length > 0 && reportLocation?.lat && reportLocation?.lng) {
    // In a real implementation, we would:
    // 1. Extract EXIF GPS from images
    // 2. Compare with report location (within ~100m radius)
    // 3. Apply bonus if match
    // For now, we'll just note that GPS matching could be implemented
    // This keeps the code structure ready for future enhancement
  }

  return {
    adjustedLegit: Math.max(0, Math.min(1.0, adjustedLegit)),
    heuristicAdjustments: adjustments
  }
}

export const processReportWithAI = async (reportId: string) => {
  try {
    console.log('🔍 Starting AI processing for report', reportId)

    // Read the key at call time (module imports are cached, env may be set after startup)
    const apiKey = process.env.OPENROUTER_API_KEY?.trim()

    if (!apiKey) {
      console.error('❌ Cannot process AI - OPENROUTER_API_KEY is missing from .env file')
      console.error('   Please add OPENROUTER_API_KEY=your_key_here to your .env file')
      return
    }
    
    if (!apiKey.startsWith('sk-or-v1-')) {
      console.warn('⚠️  Warning: OPENROUTER_API_KEY format may be incorrect (should start with "sk-or-v1-")')
    }

    // Create service per-call so we always use the latest env var
    const aiService = new AIService(apiKey)

    // Use retry for database queries
    const report = await retryQuery(async () => {
      const result = await pool.query(`
        SELECT 
          id, 
          title, 
          description, 
          images, 
          location, 
          category
        FROM reports
        WHERE id = $1
      `, [reportId])
      return result.rows[0] as any
    })

    if (!report) {
      console.error(`Report ${reportId} not found`)
      return
    }

    // Prepare data for AI analysis
    const images = Array.isArray(report.images) ? report.images : (report.images || [])

    const location = report.location || {}

    const reportData: ReportForAnalysis = {
      title: report.title,
      description: report.description,
      images,
      location,
      category: report.category,
    }

    const aiResult = await aiService.analyzeReport(reportData)
    
    // Only save AI analysis if it was successful
    if (!aiResult.success) {
      console.error(`❌ AI analysis failed for report ${reportId} - NOT saving fake data to database`)
      console.error('   Fix your OPENROUTER_API_KEY to get real AI analysis')
      return
    }

    // Apply image heuristics to adjust legitimacy score
    const { adjustedLegit, heuristicAdjustments } = applyImageHeuristics(
      aiResult.legit,
      images,
      location
    )

    // Calculate confidence_label if not provided by AI
    let confidenceLabel = aiResult.confidence_label
    if (!confidenceLabel) {
      if (adjustedLegit >= 0.85) confidenceLabel = 'very_high'
      else if (adjustedLegit >= 0.7) confidenceLabel = 'high'
      else if (adjustedLegit >= 0.3) confidenceLabel = 'medium'
      else confidenceLabel = 'low'
    }

    // Update report with AI results using retry
    await retryQuery(async () => {
      const newStatus = adjustedLegit > 0.7 ? 'community_verified' : 
                        adjustedLegit < 0.3 ? 'flagged' : 'pending'
      
      const aiScoreData = {
        legit: adjustedLegit, // Use adjusted legitimacy after heuristics
        severity: aiResult.severity,
        duplicate_prob: aiResult.duplicate_prob,
        insights: aiResult.insights,
        confidence_label: confidenceLabel,
        explanation: aiResult.explanation || 'Analysis completed based on report content and context.',
        vision_insights: ENABLE_VISION_AI ? (aiResult.vision_insights || null) : null,
        heuristic_adjustments: heuristicAdjustments, // Store for debugging
        processed_at: new Date().toISOString(),
      }
      
      await pool.query(`
        UPDATE reports 
        SET 
          ai_score = $1,
          status = $2,
          updated_at = $3
        WHERE id = $4
      `, [
        aiScoreData,
        newStatus,
        new Date().toISOString(),
        reportId
      ])
    })

    console.log('✅ AI analysis saved for report', reportId)
  } catch (error) {
    console.error(`❌ AI processing failed for report ${reportId}:`, error)
  }
}