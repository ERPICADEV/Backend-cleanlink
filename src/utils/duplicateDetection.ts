import db from '../config/sqlite'

export interface DuplicateCheckResult {
  isDuplicate: boolean
  duplicateOf?: string
  confidence: number
  reason?: string
}

export const checkForDuplicates = async (
  reportId: string,
  location: { lat: number; lng: number },
  imageHashes?: string[],
  text?: string
): Promise<DuplicateCheckResult> => {
  try {
    const { lat, lng } = location
    
    // Check for nearby reports within 200 meters in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    
    const stmt = db.prepare(`
      SELECT 
        id, 
        title, 
        description, 
        location, 
        category, 
        images,
        createdAt
      FROM reports
      WHERE id != ? 
        AND createdAt >= ?
        AND status != 'duplicate'
    `)
    
    const nearbyReports = stmt.all(reportId, thirtyDaysAgo) as any[]

    // Simple distance calculation (Haversine would be better for production)
    const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
      const R = 6371 // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180
      const dLng = (lng2 - lng1) * Math.PI / 180
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLng/2) * Math.sin(dLng/2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
      return R * c * 1000 // Distance in meters
    }

    let bestMatch: { id: string; confidence: number; reason: string } | null = null

    for (const report of nearbyReports) {
      let reportLocation
      try {
        reportLocation = JSON.parse(report.location)
      } catch {
        reportLocation = report.location
      }
      
      if (!reportLocation?.lat || !reportLocation?.lng) continue

      const distance = calculateDistance(lat, lng, reportLocation.lat, reportLocation.lng)
      
      // If within 200 meters
      if (distance <= 200) {
        let confidence = 0.3 // Base confidence for proximity
        
        // Simple text similarity (in production, use proper NLP)
        if (text && report.description) {
          const textSimilarity = calculateTextSimilarity(text, report.description)
          confidence += textSimilarity * 0.3
        }

        // Image hash matching would go here
        if (imageHashes && imageHashes.length > 0) {
          // In production, compare perceptual hashes
          confidence += 0.2
        }

        if (confidence > 0.5 && (!bestMatch || confidence > bestMatch.confidence)) {
          bestMatch = {
            id: report.id,
            confidence,
            reason: `Nearby report (${Math.round(distance)}m away) with ${Math.round(confidence * 100)}% similarity`,
          }
        }
      }
    }

    if (bestMatch && bestMatch.confidence > 0.6) {
      return {
        isDuplicate: true,
        duplicateOf: bestMatch.id,
        confidence: bestMatch.confidence,
        reason: bestMatch.reason,
      }
    }

    return {
      isDuplicate: false,
      confidence: 0,
    }
  } catch (error) {
    console.error('Duplicate detection error:', error)
    return {
      isDuplicate: false,
      confidence: 0,
      reason: 'Error in duplicate detection',
    }
  }
}

// Simple text similarity (for demo - use proper NLP in production)
const calculateTextSimilarity = (text1: string, text2: string): number => {
  const words1 = text1.toLowerCase().split(/\s+/)
  const words2 = text2.toLowerCase().split(/\s+/)
  
  const commonWords = words1.filter(word => 
    words2.includes(word) && word.length > 3
  )
  
  const maxLength = Math.max(words1.length, words2.length)
  return commonWords.length / maxLength
}