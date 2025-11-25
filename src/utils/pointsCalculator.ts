export interface PointsBreakdown {
    base: number;
    ai_bonus: number;
    severity_bonus: number;
    engagement: number;
    resolution: number;
    total: number;
  }
  
  export const calculateCivicPoints = (
    aiScore: any,
    upvotes: number,
    comments: number
  ): PointsBreakdown => {
    // Base points for report creation
    const basePoints = 30;
    
    // AI Confidence Bonus (0-20 points)
    const aiConfidence = aiScore?.legit || 0.5;
    const aiBonus = Math.floor(aiConfidence * 20);
    
    // Severity Bonus (0-15 points)
    const severity = aiScore?.severity || 0.5;
    const severityBonus = Math.floor(severity * 15);
    
    // Community Engagement Bonus (0-25 points)
    const engagementScore = Math.min((upvotes * 2) + comments, 25);
    
    // Resolution Bonus (fixed 30 points for MCD action)
    const resolutionBonus = 30;
    
    const totalPoints = basePoints + aiBonus + severityBonus + engagementScore + resolutionBonus;
    
    return {
      base: basePoints,
      ai_bonus: aiBonus,
      severity_bonus: severityBonus,
      engagement: engagementScore,
      resolution: resolutionBonus,
      total: totalPoints
    };
  };