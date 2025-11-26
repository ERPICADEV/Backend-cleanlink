import { Request, Response } from 'express';
import db from '../config/sqlite';

// GET /api/v1/map/reports
export const getMapReports = async (req: Request, res: Response) => {
  try {
    const { 
      bounds, // "lat1,lng1,lat2,lng2"
      category,
      status,
      limit = 100
    } = req.query;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    // Filter by category
    if (typeof category === 'string' && category.trim()) {
      whereClause += ' AND LOWER(category) = LOWER(?)';
      params.push(category.trim());
    }

    // Filter by status
    if (typeof status === 'string' && status.trim()) {
      whereClause += ' AND LOWER(status) = LOWER(?)';
      params.push(status.trim());
    }

    // Basic bounds filtering
    if (bounds) {
      const [southWestLat, southWestLng, northEastLat, northEastLng] = 
        (bounds as string).split(',').map(parseFloat);
      
      console.log(`Map bounds: ${southWestLat},${southWestLng} to ${northEastLat},${northEastLng}`);
    }

    const sql = `
      SELECT 
        id, title, category, status, location, images, 
        upvotes, downvotes, created_at, ai_score, reporter_display
      FROM reports 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ?
    `;
    
    params.push(parseInt(limit as string));

    const stmt = db.prepare(sql);
    const reports = stmt.all(...params) as any[];

    // Format for map consumption
    const mapData = reports.map(report => {
      const location = report.location ? JSON.parse(report.location) : {};
      const aiScore = report.ai_score ? JSON.parse(report.ai_score) : {};
      
      return {
        id: report.id,
        type: 'report',
        geometry: {
          type: 'Point',
          coordinates: [location.lng, location.lat] // GeoJSON format: [lng, lat]
        },
        properties: {
          title: report.title,
          category: report.category,
          status: report.status,
          area_name: location.area_name,
          upvotes: report.upvotes,
          downvotes: report.downvotes,
          created_at: report.created_at,
          reporter: report.reporter_display,
          ai_confidence: aiScore?.legit || 0.5,
          severity: aiScore?.severity || 0.5,
          image_count: report.images ? JSON.parse(report.images).length : 0,
          // Status-based styling
          color: getStatusColor(report.status),
          icon: getCategoryIcon(report.category)
        }
      };
    });

    return res.status(200).json({
      type: 'FeatureCollection',
      features: mapData
    });
  } catch (error) {
    console.error('Get map reports error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch map data' },
    });
  }
};

// GET /api/v1/map/clusters (for handling many points)
export const getMapClusters = async (req: Request, res: Response) => {
  try {
    const { zoom, bounds } = req.query;

    // Simple clustering - get reports
    const reportsStmt = db.prepare(`
      SELECT id, location, category, status 
      FROM reports 
      LIMIT 500
    `);
    const reports = reportsStmt.all() as any[];

    // Simple clustering by rounding coordinates
    const clusterZoom = parseInt(zoom as string) || 10;
    const precision = Math.pow(10, Math.floor(clusterZoom / 3));
    
    const clusters: any = {};
    
    reports.forEach(report => {
      const location = report.location ? JSON.parse(report.location) : {};
      if (!location?.lat || !location?.lng) return;

      // Simple grid-based clustering
      const clusterKey = `${Math.round(location.lat * precision)},${Math.round(location.lng * precision)}`;
      
      if (!clusters[clusterKey]) {
        clusters[clusterKey] = {
          count: 0,
          lat: location.lat,
          lng: location.lng,
          categories: new Set(),
          statuses: new Set()
        };
      }
      
      clusters[clusterKey].count++;
      clusters[clusterKey].categories.add(report.category);
      clusters[clusterKey].statuses.add(report.status);
    });

    const clusterData = Object.values(clusters).map((cluster: any) => ({
      type: 'cluster',
      geometry: {
        type: 'Point',
        coordinates: [cluster.lng, cluster.lat]
      },
      properties: {
        point_count: cluster.count,
        categories: Array.from(cluster.categories),
        statuses: Array.from(cluster.statuses),
        // Size based on count
        size: Math.min(cluster.count * 2, 20)
      }
    }));

    return res.status(200).json({
      type: 'FeatureCollection',
      features: clusterData
    });
  } catch (error) {
    console.error('Get map clusters error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch cluster data' },
    });
  }
};

// GET /api/v1/map/stats
export const getMapStats = async (req: Request, res: Response) => {
  try {
    // Get category and status stats
    const categoryStatsStmt = db.prepare(`
      SELECT category, status, COUNT(*) as count 
      FROM reports 
      GROUP BY category, status
    `);
    const categoryStats = categoryStatsStmt.all() as any[];

    // Fetch reports for location stats
    const reportsStmt = db.prepare('SELECT location FROM reports');
    const reports = reportsStmt.all() as any[];

    // Manual aggregation for location stats
    const areaMap: Record<string, any> = {};

    reports.forEach(report => {
      const location = report.location ? JSON.parse(report.location) : {};
      if (!location?.lat || !location?.lng) return;

      const key = `${location.lat}_${location.lng}`;

      if (!areaMap[key]) {
        areaMap[key] = {
          area_name: location.area_name,
          lat: location.lat,
          lng: location.lng,
          count: 0
        };
      }

      areaMap[key].count++;
    });

    // Convert to array & limit to 50
    const areaStats = Object.values(areaMap)
      .sort((a: any, b: any) => b.count - a.count)
      .slice(0, 50);

    return res.status(200).json({
      category_stats: categoryStats,
      hotspot_areas: areaStats.map((a: any) => ({
        area_name: a.area_name,
        report_count: a.count,
        coordinates: {
          lat: a.lat,
          lng: a.lng
        }
      }))
    });
  } catch (error) {
    console.error('Get map stats error:', error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch map stats' },
    });
  }
};

// Helper functions for map styling
function getStatusColor(status: string): string {
  const colors: { [key: string]: string } = {
    'pending': '#F59E0B', // Amber
    'community_verified': '#3B82F6', // Blue
    'assigned': '#8B5CF6', // Purple
    'resolved': '#10B981', // Green
    'flagged': '#EF4444', // Red
    'duplicate': '#6B7280' // Gray
  };
  return colors[status] || '#6B7280';
}

function getCategoryIcon(category: string): string {
  const icons: { [key: string]: string } = {
    'garbage': '🗑️',
    'road': '🛣️',
    'water': '💧',
    'tree': '🌳',
    'electricity': '⚡',
    'other': '📍'
  };
  return icons[category] || '📍';
}