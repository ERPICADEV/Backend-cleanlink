import axios from 'axios';

export interface AIAnalysisResult {
  legit: number;
  severity: number;
  duplicate_prob: number;
  insights: string[];
  duplicate_of?: string;
  confidence_label?: string; // "low" | "medium" | "high" | "very_high"
  explanation?: string; // Human-readable explanation
  vision_insights?: string[] | null; // Placeholder for future vision AI
  success: boolean; // Indicates if this is a real analysis or fallback
  // Extended fields for report generation
  category?: string;
  title?: string;
  description?: string;
}

export interface ReportForAnalysis {
  title: string;
  description: string;
  images: any[]; // More flexible
  location: any;
  category: string;
}

export class AIService {
  private apiKey: string;
  private baseURL: string = 'https://openrouter.ai/api/v1';
  private model: string;

  constructor(apiKey: string) {
    if (!apiKey || !apiKey.trim()) {
      throw new Error('API key is required for AIService');
    }
    this.apiKey = apiKey.trim();
    this.model = process.env.OPENROUTER_MODEL?.trim() || "allenai/molmo-2-8b:free";
    
    // Log API key info (first few chars only for security)
    console.log(`🤖 AIService initialized with model: ${this.model}`);
    console.log(`   API key (first 15 chars): ${this.apiKey.substring(0, 15)}...`);
  }

  async analyzeReport(reportData: ReportForAnalysis): Promise<AIAnalysisResult> {
    try {
      // Prepare prompt and image payload for the AI
      const prompt = this.createAnalysisPrompt(reportData);

      // Try to extract image URLs from reportData.images (MVP: assume they are URLs or { url })
      const imageUrls: string[] = Array.isArray(reportData.images)
        ? reportData.images
            .map((img: any) => {
              if (!img) return null;
              if (typeof img === 'string') return img;
              if (typeof img === 'object' && typeof img.url === 'string') return img.url;
              return null;
            })
            .filter((u: string | null): u is string => !!u)
        : [];

      // Build messages payload; for vision models we send text + images together
      const userContent: any =
        imageUrls.length > 0
          ? [
              { type: 'text', text: prompt },
              ...imageUrls.map((url) => ({
                type: 'image_url',
                image_url: { url },
              })),
            ]
          : prompt;
      
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: "system",
              content: "You are a garbage detection AI for a civic reporting app. Analyze reports and provide legitimacy scores, severity estimates, and insights."
            },
            {
              role: "user",
              content: userContent
            }
          ],
          max_tokens: 500
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const aiResponse = response.data.choices[0].message.content;
      const result = this.parseAIResponse(aiResponse);
      return { ...result, success: true };
      
    } catch (error: any) {
      // Better error handling
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const data = error.response.data;
        
        if (status === 401) {
          console.error('❌ AI Service: Unauthorized (401) - Check your OPENROUTER_API_KEY in .env file');
          console.error('   The API key may be invalid, expired, or missing');
          console.error('   Debug:', { model: this.model });
        } else if (status === 429) {
          console.error('❌ AI Service: Rate limit exceeded (429) - Too many requests');
          console.error('   Debug:', { model: this.model });
        } else if (status === 404) {
          console.error('❌ AI Service: Not found (404) - Model or endpoint may be invalid');
          console.error('   Debug:', { model: this.model, data });
        } else {
          console.error(`❌ AI Service error: ${status} ${statusText}`);
          console.error('   Debug:', { model: this.model, data });
        }
      } else if (error.request) {
        console.error('❌ AI Service: No response from OpenRouter API - Check your internet connection');
      } else {
        console.error('❌ AI Service error:', error.message);
      }
      
      // Return failure indicator - DO NOT save fake data to database
      return {
        legit: 0.5,
        severity: 0.5,
        duplicate_prob: 0,
        insights: ['ai_service_unavailable'],
        confidence_label: 'medium',
        explanation: 'Analysis temporarily unavailable.',
        success: false
      };
    }
  }

  private createAnalysisPrompt(reportData: ReportForAnalysis): string {
    const hasImages = Array.isArray(reportData.images) && reportData.images.length > 0;
    return `
Analyze this civic report and provide a JSON response with:

1. legit: probability this is a real garbage report (0-1)
2. severity: how serious the issue is (0-1)  
3. duplicate_prob: probability this is duplicate (0-1)
4. insights: array of key insights
5. confidence_label: string enum - "low" (legit < 0.3), "medium" (0.3 ≤ legit < 0.7), "high" (0.7 ≤ legit < 0.85), "very_high" (legit ≥ 0.85)
6. explanation: short human-readable sentence (1-2 lines max) explaining WHY you gave these legitimacy and severity scores. Be calm, neutral, and civic-friendly. Do NOT mention AI uncertainty or model limitations.
7. vision_insights: array of 2-5 short strings describing what you can see in the image(s) and whether it matches the report (e.g. ["visible trash bags near curb", "image matches described location", "no people visible"]). If the image(s) are blank, unrelated, or cannot be interpreted, say so plainly (e.g. ["image unclear/blank/unrelated"]).

Report Details:
- Title: ${reportData.title}
- Description: ${reportData.description}
- Category: ${reportData.category}
- Images: ${reportData.images.length} images provided
- Location: ${JSON.stringify(reportData.location)}

Consider:
- Does the description sound genuine?
- Is this a common issue in civic reporting?
- Are there red flags for fake reports?
- How urgent does this seem?
${hasImages ? `- IMPORTANT: You MUST use the image(s) to inform the scores and MUST mention image evidence in "explanation".` : ''}

Respond ONLY with valid JSON, no other text.
Example: {"legit": 0.8, "severity": 0.7, "duplicate_prob": 0.1, "insights": ["genuine_report", "medium_urgency"], "confidence_label": "high", "vision_insights": ["trash bags visible on roadside", "image supports the report description"], "explanation": "The photo shows roadside trash consistent with the description, indicating a legitimate issue with moderate urgency."}
    `;
  }

  async analyzeReportWithCustomPrompt(
    reportData: ReportForAnalysis,
    customPrompt: string
  ): Promise<AIAnalysisResult> {
    try {
      // Try to extract image URLs from reportData.images
      const imageUrls: string[] = Array.isArray(reportData.images)
        ? reportData.images
            .map((img: any) => {
              if (!img) return null;
              if (typeof img === 'string') return img;
              if (typeof img === 'object' && typeof img.url === 'string') return img.url;
              return null;
            })
            .filter((u: string | null): u is string => !!u)
        : [];

      // Build messages payload; for vision models we send text + images together
      const userContent: any =
        imageUrls.length > 0
          ? [
              { type: 'text', text: customPrompt },
              ...imageUrls.map((url) => ({
                type: 'image_url',
                image_url: { url },
              })),
            ]
          : customPrompt;
      
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: "system",
              content: "You are an AI assistant for a civic reporting app. Analyze images and generate report data including category, title, description, and legitimacy scores."
            },
            {
              role: "user",
              content: userContent
            }
          ],
          max_tokens: 800 // Increased for more detailed responses
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const aiResponse = response.data.choices[0].message.content;
      console.log('📥 Raw AI response (first 200 chars):', aiResponse.substring(0, 200));
      const result = this.parseAIResponse(aiResponse);
      console.log('📦 Parsed AI result:', {
        hasCategory: !!result.category,
        hasTitle: !!result.title,
        hasDescription: !!result.description,
        category: result.category,
        title: result.title?.substring(0, 30),
        success: result.success
      });
      // Preserve the success flag from parsing - don't override it
      return result;
      
    } catch (error: any) {
      // Better error handling - show actual error instead of generic message
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText;
        const data = error.response.data;
        
        if (status === 401) {
          console.error('❌ AI Service: Unauthorized (401) - Invalid API key');
          console.error('   Error message:', data?.error?.message || 'User not found');
          console.error('   Check your OPENROUTER_API_KEY in .env file');
          console.error('   API key format should start with: sk-or-v1-');
          console.error('   Current key (first 15 chars):', this.apiKey.substring(0, 15) + '...');
          
          // Throw error so it can be handled properly by the controller
          throw new Error(`OpenRouter API authentication failed: ${data?.error?.message || 'Invalid API key'}. Please check your OPENROUTER_API_KEY in .env file.`);
        } else if (status === 429) {
          console.error('❌ AI Service: Rate limit exceeded (429)');
          throw new Error('AI service rate limit exceeded. Please try again later.');
        } else if (status === 400) {
          console.error('❌ AI Service: Bad request (400)');
          console.error('   Error details:', data);
          throw new Error(`AI service error: ${data?.error?.message || 'Invalid request'}`);
        } else {
          console.error(`❌ AI Service error: ${status} ${statusText}`);
          console.error('   Error details:', data);
          throw new Error(`AI service error: ${data?.error?.message || statusText}`);
        }
      } else if (error.request) {
        console.error('❌ AI Service: No response from OpenRouter API');
        throw new Error('AI service unavailable. Please check your internet connection.');
      } else {
        console.error('❌ AI Service error:', error.message);
        throw error; // Re-throw to preserve original error
      }
    }
  }

  private parseAIResponse(response: string): AIAnalysisResult {
    try {
      // Extract JSON from response - try multiple patterns
      let jsonMatch = response.match(/\{[\s\S]*\}/); // More flexible pattern
      
      // If no match, try to find JSON between code blocks
      if (!jsonMatch) {
        jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          jsonMatch = [jsonMatch[0], jsonMatch[1]]; // Use the captured group
        }
      }
      
      if (jsonMatch) {
        const jsonString = jsonMatch[1] || jsonMatch[0]; // Use captured group if available
        const parsed = JSON.parse(jsonString);
        
        console.log('✅ Successfully parsed AI JSON response');
        
        // Calculate confidence_label if not provided
        if (!parsed.confidence_label && parsed.legit !== undefined) {
          const legit = parsed.legit;
          if (legit >= 0.85) parsed.confidence_label = 'very_high';
          else if (legit >= 0.7) parsed.confidence_label = 'high';
          else if (legit >= 0.3) parsed.confidence_label = 'medium';
          else parsed.confidence_label = 'low';
        }
        
        // Ensure explanation exists
        if (!parsed.explanation) {
          parsed.explanation = 'Analysis completed based on report content and context.';
        }
        
        // Validate that we have the required fields for report generation
        if (!parsed.category && !parsed.title && !parsed.description) {
          console.warn('⚠️  AI response missing category, title, and description fields');
          console.warn('   Response keys:', Object.keys(parsed));
        }
        
        return { ...parsed, success: true };
      } else {
        console.error('❌ No JSON found in AI response');
        console.error('   Response (first 500 chars):', response.substring(0, 500));
      }
    } catch (error: any) {
      console.error('❌ Failed to parse AI response:', error.message);
      console.error('   Response (first 500 chars):', response.substring(0, 500));
    }
    
    // Fallback if parsing fails - but this should not happen if API is working
    console.error('❌ Returning fallback response - AI parsing failed');
    return {
      legit: 0.5,
      severity: 0.5,
      duplicate_prob: 0,
      insights: ['response_parse_failed'],
      confidence_label: 'medium',
      explanation: 'Failed to parse AI response. Please check server logs.',
      success: false
    };
  }
}