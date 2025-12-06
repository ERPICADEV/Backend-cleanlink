import { Request, Response } from 'express';
import { pool } from '../config/postgres';
import { handleDatabaseError } from '../utils/dbErrorHandler';

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
    let paramIndex = 1;

    // Filter by category
    if (typeof category === 'string' && category.trim()) {
      whereClause += ` AND LOWER(category) = LOWER($${paramIndex})`;
      params.push(category.trim());
      paramIndex++;
    }

    // Filter by status
    if (typeof status === 'string' && status.trim()) {
      whereClause += ` AND LOWER(status) = LOWER($${paramIndex})`;
      params.push(status.trim());
      paramIndex++;
    }

    // Basic bounds filtering
    if (bounds) {
      const [southWestLat, southWestLng, northEastLat, northEastLng] = 
        (bounds as string).split(',').map(parseFloat);
    }

    const sql = `
      SELECT 
        id, title, category, status, location, images, 
        upvotes, downvotes, created_at, ai_score, reporter_display
      FROM reports 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}
    `;
    
    params.push(parseInt(limit as string));

    const result = await pool.query(sql, params);
    const reports = result.rows as any[];

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
    const errorResponse = handleDatabaseError(error, 'Failed to fetch map data');
    if (errorResponse.status === 503) {
      console.warn('⚠️  Database connection error in getMapReports');
    } else {
      console.error('Get map reports error:', error);
    }
    res.status(errorResponse.status).json(errorResponse.error);
  }
};

// GET /api/v1/map/clusters (for handling many points)
export const getMapClusters = async (req: Request, res: Response) => {
  try {
    const { zoom, bounds } = req.query;

    // Simple clustering - get reports
    const reportsResult = await pool.query(`
      SELECT id, location, category, status 
      FROM reports 
      LIMIT 500
    `);
    const reports = reportsResult.rows as any[];

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
    const errorResponse = handleDatabaseError(error, 'Failed to fetch cluster data');
    if (errorResponse.status === 503) {
      console.warn('⚠️  Database connection error in getMapClusters');
    } else {
      console.error('Get map clusters error:', error);
    }
    res.status(errorResponse.status).json(errorResponse.error);
  }
};

// GET /api/v1/map/stats
export const getMapStats = async (req: Request, res: Response) => {
  try {
    // Get category and status stats
    const categoryStatsResult = await pool.query(`
      SELECT category, status, COUNT(*) as count 
      FROM reports 
      GROUP BY category, status
    `);
    const categoryStats = categoryStatsResult.rows as any[];

    // Fetch reports for location stats
    const reportsResult = await pool.query('SELECT location FROM reports');
    const reports = reportsResult.rows as any[];

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
    const errorResponse = handleDatabaseError(error, 'Failed to fetch map stats');
    if (errorResponse.status === 503) {
      console.warn('⚠️  Database connection error in getMapStats');
    } else {
      console.error('Get map stats error:', error);
    }
    res.status(errorResponse.status).json(errorResponse.error);
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