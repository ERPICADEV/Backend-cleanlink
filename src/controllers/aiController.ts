import { Request, Response } from 'express';
import { pool } from '../config/postgres';
import { randomUUID } from 'crypto';
import { AIService, ReportForAnalysis } from '../services/aiService';
import { reverseGeocode, ReverseGeocodeResult } from '../services/geocodingService';

// POST /internal/ai/reports/:id/result - Internal AI service
export const updateAIResult = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      ai_score, 
      duplicate_of, 
      insights,
      duplicate_prob 
    } = req.body;

    // Validate required fields
    if (!ai_score || typeof ai_score.legit !== 'number') {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'ai_score with legit probability is required',
        },
      });
    }

    // Check if report exists
    const reportResult = await pool.query('SELECT id, status FROM reports WHERE id = $1', [id]);
    const report = reportResult.rows[0] as any;

    if (!report) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Report not found' },
      });
    }

    // Transaction for atomic operations
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update AI score
      await client.query(
        `UPDATE reports 
         SET ai_score = $1, 
             duplicate_of = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [JSON.stringify(ai_score), duplicate_of || null, id]
      );

      // Update status based on AI score
      const legit = ai_score.legit || 0.5;
      let newStatus = report.status;
      if (legit < 0.3) {
        newStatus = 'flagged';
      } else if (legit >= 0.7) {
        newStatus = 'community_verified';
      } else {
        newStatus = 'pending';
      }

      if (newStatus !== report.status) {
        await client.query(
          `UPDATE reports SET status = $1 WHERE id = $2`,
          [newStatus, id]
        );
      }

      await client.query('COMMIT');

      return res.status(200).json({
        id,
        status: newStatus,
        ai_score,
        duplicate_of: duplicate_of || null,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Update AI result error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update AI result',
      },
    });
  }
};

// GET /internal/ai/reports/pending - Get reports pending AI analysis
export const getPendingAIReports = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, title, description, category, images, location, created_at
       FROM reports
       WHERE ai_score IS NULL
       ORDER BY created_at ASC
       LIMIT 10`
    );

    return res.status(200).json({
      reports: result.rows,
    });
  } catch (error: any) {
    console.error('Get pending AI reports error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch pending reports',
      },
    });
  }
};

// POST /api/v1/ai/analyze-report - Analyze image and generate report data
export const analyzeReport = async (req: Request, res: Response) => {
  try {
    const { image, lat, lng } = req.body;

    // Validate required fields
    if (!image) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Image is required',
        },
      });
    }

    // Make location optional - if not provided or invalid, skip reverse geocoding
    // Location can be undefined, null, or invalid numbers
    let hasValidLocation = typeof lat === 'number' && typeof lng === 'number' && 
                          !isNaN(lat) && !isNaN(lng) &&
                          lat >= -90 && lat <= 90 && // Valid latitude range
                          lng >= -180 && lng <= 180; // Valid longitude range

    let finalLat = hasValidLocation ? lat : 0;
    let finalLng = hasValidLocation ? lng : 0;

    // Step 1: Reverse geocode to get address (only if we have valid coordinates)
    let addressData: ReverseGeocodeResult = {
      country: 'India', // Default
    };
    if (hasValidLocation) {
      try {
        const geocodeResult = await reverseGeocode(finalLat, finalLng);
        addressData = {
          ...geocodeResult,
          country: geocodeResult.country || 'India', // Ensure country is always set
        };
      } catch (error) {
        console.error('Reverse geocoding failed:', error);
        // Continue with default address data
      }
    }

    // Step 2: Call AI to analyze image and generate title/description/category
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      console.error('❌ OPENROUTER_API_KEY is missing from environment variables');
      return res.status(500).json({
        error: {
          code: 'CONFIGURATION_ERROR',
          message: 'AI service not configured. Please set OPENROUTER_API_KEY in your .env file.',
        },
      });
    }

    // Validate API key format
    if (!apiKey.startsWith('sk-or-v1-')) {
      console.warn('⚠️  Warning: OPENROUTER_API_KEY format may be incorrect (should start with "sk-or-v1-")');
      console.warn(`   Current key starts with: ${apiKey.substring(0, 10)}...`);
    }

    console.log('🔑 Using OpenRouter API key (first 15 chars):', apiKey.substring(0, 15) + '...');
    const aiService = new AIService(apiKey);

    // Create a prompt for AI to analyze the image and generate report data
    const analysisPrompt = `
Analyze this civic report image and provide a JSON response with:

1. category: one of ["Garbage", "Road", "Water", "Trees", "Electricity", "Other"] - detect the issue type from the image
   IMPORTANT: If the image is NOT a genuine civic issue (e.g., meme, unrelated photo, fake, etc.), you MUST set category to "Other" regardless of what appears in the image.
2. title: a short, descriptive title (max 60 characters) for the issue shown in the image
3. description: a brief description (2-3 sentences, max 200 characters) of what you see in the image
4. legit: probability this is a real civic issue (0-1) based on the image
   - If legit < 0.3, the image is likely fake/meme/unrelated → category MUST be "Other"
   - If legit ≥ 0.3, categorize based on what you see (Garbage, Road, Water, Trees, Electricity)
5. severity: how serious the issue is (0-1) based on the image (only relevant if legit ≥ 0.3)
6. duplicate_prob: probability this is duplicate (0-1)
7. confidence_label: "low" (legit < 0.3), "medium" (0.3 ≤ legit < 0.7), "high" (0.7 ≤ legit < 0.85), "very_high" (legit ≥ 0.85)
8. explanation: short human-readable sentence explaining the analysis
9. vision_insights: array of 2-5 short strings describing what you can see in the image
10. insights: array of key insights about the report

Location context: ${JSON.stringify(addressData)}

CRITICAL RULES:
- If legit < 0.3 OR the image is clearly not a civic issue (meme, unrelated photo, fake, etc.), category MUST be "Other"
- Category should match the legitimacy assessment - don't categorize fake images as Garbage/Road/etc.
- Only use specific categories (Garbage, Road, Water, Trees, Electricity) if legit ≥ 0.3 AND the image shows a genuine issue of that type

IMPORTANT: You MUST include category, title, and description fields in your JSON response.

Respond ONLY with valid JSON, no other text.
Example for genuine issue: {"category": "Garbage", "title": "Pile of trash near park entrance", "description": "Large accumulation of mixed waste including plastic bags and food containers visible near the park entrance. The area appears unmaintained.", "legit": 0.85, "severity": 0.7, "duplicate_prob": 0.1, "confidence_label": "high", "explanation": "The image clearly shows accumulated waste that requires civic attention.", "vision_insights": ["visible trash bags", "waste accumulation near public area", "unmaintained location"], "insights": ["genuine_report", "medium_urgency"]}
Example for fake/meme: {"category": "Other", "title": "Unrelated Image Detected", "description": "The image appears to be a screenshot, meme, or unrelated photo rather than a genuine civic issue report.", "legit": 0.2, "severity": 0.1, "duplicate_prob": 0.0, "confidence_label": "low", "explanation": "The image seems to be a screenshot or edited image from a meme or social media, not a genuine civic report.", "vision_insights": ["image appears to be a meme or unrelated content", "no visible civic issue"], "insights": ["likely_fake", "unrelated_image"]}
    `;

    // Prepare image for AI (base64 data URL)
    const imageUrl = image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`;

    const reportForAnalysis: ReportForAnalysis = {
      title: '', // Will be generated by AI
      description: '', // Will be generated by AI
      images: [imageUrl],
      location: { lat, lng, ...addressData },
      category: '', // Will be generated by AI
    };

    // Call AI with custom prompt for report generation
    let aiResponse;
    try {
      aiResponse = await aiService.analyzeReportWithCustomPrompt(
        reportForAnalysis,
        analysisPrompt
      );
      
      // Check if AI analysis was successful
      if (!aiResponse.success) {
        console.error('❌ AI analysis returned success: false');
        console.error('   Response:', JSON.stringify(aiResponse, null, 2));
        return res.status(500).json({
          error: {
            code: 'AI_SERVICE_ERROR',
            message: aiResponse.explanation || 'AI analysis failed',
            details: 'The AI service returned an unsuccessful response. Please try again.',
          },
        });
      }
      
      console.log('✅ AI analysis successful');
      console.log('   Category:', aiResponse.category);
      console.log('   Title:', aiResponse.title);
      console.log('   Description:', aiResponse.description?.substring(0, 50) + '...');
    } catch (aiError: any) {
      console.error('❌ AI analysis failed with exception:', aiError);
      console.error('   Error message:', aiError.message);
      console.error('   Stack:', aiError.stack);
      // Return error with helpful message
      return res.status(500).json({
        error: {
          code: 'AI_SERVICE_ERROR',
          message: aiError.message || 'Failed to analyze report with AI',
          details: 'Please check your OPENROUTER_API_KEY in .env file and ensure it is valid.',
        },
      });
    }

    // Extract category, title, description from AI response
    let category = aiResponse.category || 'Other';
    const title = aiResponse.title || 'Civic Issue Report';
    const description = aiResponse.description || aiResponse.explanation || 'Issue detected in the area.';
    const legit = aiResponse.legit ?? 0.5;
    
    // Log if we're using fallback values
    if (!aiResponse.category) {
      console.warn('⚠️  AI response missing category, using fallback: Other');
    }
    if (!aiResponse.title) {
      console.warn('⚠️  AI response missing title, using fallback');
    }
    if (!aiResponse.description && !aiResponse.explanation) {
      console.warn('⚠️  AI response missing description, using fallback');
    }

    // Validate category and enforce logic: if legit is very low, force "Other"
    const validCategories = ['Garbage', 'Road', 'Water', 'Trees', 'Electricity', 'Other'];
    let finalCategory = validCategories.includes(category) ? category : 'Other';
    
    // Override category to "Other" if legitimacy is too low (likely fake/meme/unrelated)
    if (legit < 0.3 && finalCategory !== 'Other') {
      console.log(`⚠️  Overriding category from "${finalCategory}" to "Other" because legit score is ${legit} (< 0.3)`);
      finalCategory = 'Other';
    }
    
    // Also check if category doesn't match legitimacy - if legit is low but category is specific, force Other
    if (legit < 0.5 && finalCategory !== 'Other') {
      console.log(`⚠️  Overriding category from "${finalCategory}" to "Other" because legit score ${legit} suggests this is not a genuine issue`);
      finalCategory = 'Other';
    }

    // Determine suggested status based on legit score (same logic as AI worker)
    let suggestedStatus = 'pending';
    if (legit < 0.3) {
      suggestedStatus = 'flagged';
    } else if (legit >= 0.7) {
      suggestedStatus = 'community_verified';
    }
    
    console.log(`📊 Suggested status: ${suggestedStatus} (based on legit score: ${legit})`);

    // Return the analysis result
    return res.status(200).json({
      category: finalCategory,
      title: title.substring(0, 60), // Ensure max 60 chars
      description: description.substring(0, 600), // Ensure max 600 chars
      location: hasValidLocation ? {
        lat: finalLat,
        lng: finalLng,
        ...addressData,
      } : {
        // Return empty location if invalid - form page will detect it
        country: 'India',
      },
      ai_analysis: {
        legit: aiResponse.legit,
        severity: aiResponse.severity,
        duplicate_prob: aiResponse.duplicate_prob,
        confidence_label: aiResponse.confidence_label,
        explanation: aiResponse.explanation,
        vision_insights: aiResponse.vision_insights,
        insights: aiResponse.insights,
      },
      suggested_status: suggestedStatus, // Add suggested status for immediate use
    });
  } catch (error: any) {
    console.error('Analyze report error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to analyze report',
      },
    });
  }
};
