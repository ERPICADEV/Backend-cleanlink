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
    this.apiKey = apiKey;
    this.model = process.env.OPENROUTER_MODEL?.trim() || "allenai/molmo-2-8b:free";
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

  private parseAIResponse(response: string): AIAnalysisResult {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{.*\}/s); // 's' flag for multiline
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
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
        
        return { ...parsed, success: true };
      }
    } catch (error) {
      console.error('Failed to parse AI response:', error);
    }
    
    // Fallback if parsing fails
    return {
      legit: 0.5,
      severity: 0.5,
      duplicate_prob: 0,
      insights: ['response_parse_failed'],
      confidence_label: 'medium',
      explanation: 'Analysis temporarily unavailable.',
      success: false
    };
  }
}