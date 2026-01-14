import axios from 'axios';

export interface PreSubmissionData {
  title: string;
  description: string;
  category: string;
  imageCount: number;
}

export interface PreSubmissionSuggestions {
  suggestions: string[];
}

export class PreSubmissionService {
  private apiKey: string;
  private baseURL: string = 'https://openrouter.ai/api/v1';
  private model: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    // Allow overriding the model without code changes
    // Examples: "openai/gpt-4o-mini", "anthropic/claude-3.5-haiku"
    this.model = process.env.OPENROUTER_MODEL?.trim() || "allenai/molmo-2-8b:free";
  }

  async getSuggestions(data: PreSubmissionData): Promise<PreSubmissionSuggestions> {
    try {
      if (!this.apiKey?.trim()) {
        // Non-blocking: if no key, just skip suggestions quietly
        return { suggestions: [] };
      }

      const prompt = this.createSuggestionPrompt(data);
      
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant for a civic reporting platform. Provide friendly, optional tips to improve report quality. Be supportive and encouraging."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: 200
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const aiResponse = response.data.choices[0].message.content;
      const result = this.parseSuggestionsResponse(aiResponse);
      return result;
      
    } catch (error: any) {
      // Graceful fallback - return empty suggestions on failure
      if (error?.response) {
        console.error('Pre-submission suggestions error:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          model: this.model,
        });
      } else {
        console.error('Pre-submission suggestions error:', error?.message || error);
      }
      return { suggestions: [] };
    }
  }

  private createSuggestionPrompt(data: PreSubmissionData): string {
    return `
Analyze this draft civic report and provide up to 3 friendly, optional suggestions to improve its quality.

Draft Report:
- Title: ${data.title}
- Description: ${data.description}
- Category: ${data.category}
- Images: ${data.imageCount} image(s) provided

Rules:
- Max 3 suggestions
- Friendly, supportive tone (tips, not warnings)
- Each suggestion should be 1 sentence
- Focus on helpful improvements (e.g., adding details, photos, landmarks)
- Do NOT be critical or judgmental
- Suggestions are OPTIONAL and non-blocking

Respond ONLY with valid JSON: {"suggestions": ["suggestion 1", "suggestion 2", ...]}
Example: {"suggestions": ["Adding how long the garbage has been there helps verification.", "Uploading a photo usually improves report credibility."]}
    `;
  }

  private parseSuggestionsResponse(response: string): PreSubmissionSuggestions {
    try {
      const jsonMatch = response.match(/\{.*\}/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
          // Limit to max 3 suggestions
          return {
            suggestions: parsed.suggestions.slice(0, 3)
          };
        }
      }
    } catch (error) {
      console.error('Failed to parse suggestions response:', error);
    }
    
    // Fallback
    return { suggestions: [] };
  }
}



