import axios from 'axios';

export interface AIAnalysisResult {
  legit: number;
  severity: number;
  duplicate_prob: number;
  insights: string[];
  duplicate_of?: string;
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
      return this.parseAIResponse(aiResponse);
      
    } catch (error) {
      console.error('AI Service error:', error);
      // Return default values if AI fails
      return {
        legit: 0.5,
        severity: 0.5,
        duplicate_prob: 0,
        insights: ['ai_service_unavailable']
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
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error('Failed to parse AI response:', error);
    }
    
    // Fallback if parsing fails
    return {
      legit: 0.5,
      severity: 0.5,
      duplicate_prob: 0,
      insights: ['response_parse_failed']
    };
  }
}