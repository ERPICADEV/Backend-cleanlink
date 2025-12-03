import axios from 'axios';

export interface AIAnalysisResult {
  legit: number;
  severity: number;
  duplicate_prob: number;
  insights: string[];
  duplicate_of?: string;
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

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async analyzeReport(reportData: ReportForAnalysis): Promise<AIAnalysisResult> {
    try {
      // Prepare prompt for the AI
      const prompt = this.createAnalysisPrompt(reportData);
      
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: "openai/gpt-oss-20b:free", // Free model
          messages: [
            {
              role: "system",
              content: "You are a garbage detection AI for a civic reporting app. Analyze reports and provide legitimacy scores, severity estimates, and insights."
            },
            {
              role: "user",
              content: prompt
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
        
        if (status === 401) {
          console.error('❌ AI Service: Unauthorized (401) - Check your OPENROUTER_API_KEY in .env file');
          console.error('   The API key may be invalid, expired, or missing');
        } else if (status === 429) {
          console.error('❌ AI Service: Rate limit exceeded (429) - Too many requests');
        } else {
          console.error(`❌ AI Service error: ${status} ${statusText}`);
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
        success: false
      };
    }
  }

  private createAnalysisPrompt(reportData: ReportForAnalysis): string {
    return `
Analyze this civic report and provide a JSON response with:

1. legit: probability this is a real garbage report (0-1)
2. severity: how serious the issue is (0-1)  
3. duplicate_prob: probability this is duplicate (0-1)
4. insights: array of key insights

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

Respond ONLY with valid JSON, no other text.
Example: {"legit": 0.8, "severity": 0.7, "duplicate_prob": 0.1, "insights": ["genuine_report", "medium_urgency"]}
    `;
  }

  private parseAIResponse(response: string): AIAnalysisResult {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{.*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
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
      success: false
    };
  }
}