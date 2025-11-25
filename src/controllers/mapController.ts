import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import prisma from '../config/database';

// GET /api/v1/map/reports
export const getMapReports = async (req: Request, res: Response) => {
  try {
    const { 
      bounds, // "lat1,lng1,lat2,lng2"
      category,
      status,
      limit = 100
    } = req.query;

    const where: Prisma.ReportWhereInput = {};

    // Filter by category
    if (typeof category === 'string' && category.trim()) {
      where.category = {
        equals: category.trim(),
        mode: 'insensitive'
      };
    }

    // Filter by status
    if (typeof status === 'string' && status.trim()) {
      where.status = {
        equals: status.trim(),
        mode: 'insensitive'
      };
    }

    // Basic bounds filtering (in production, use PostGIS for proper spatial queries)
    if (bounds) {
      const [southWestLat, southWestLng, northEastLat, northEastLng] = 
        (bounds as string).split(',').map(parseFloat);
      
      // Simple approximate filtering - in production use proper spatial queries
      console.log(`Map bounds: ${southWestLat},${southWestLng} to ${northEastLat},${northEastLng}`);
    }

    const reports = await prisma.report.findMany({
      where,
      take: parseInt(limit as string),
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        location: true,
        images: true,
        upvotes: true,
        downvotes: true,
        createdAt: true,
        aiScore: true,
        reporterDisplay: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Format for map consumption
    const mapData = reports.map(report => {
      const location = report.location as any;
      const aiScore = report.aiScore as any;
      
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
          created_at: report.createdAt,
          reporter: report.reporterDisplay,
          ai_confidence: aiScore?.legit || 0.5,
          severity: aiScore?.severity || 0.5,
          image_count: Array.isArray(report.images) ? report.images.length : 0,
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

    // Simple clustering - in production use proper clustering algorithms
    const reports = await prisma.report.findMany({
      take: 500, // Limit for performance
      select: {
        id: true,
        location: true,
        category: true,
        status: true,
      }
    });

    // Simple clustering by rounding coordinates
    const clusterZoom = parseInt(zoom as string) || 10;
    const precision = Math.pow(10, Math.floor(clusterZoom / 3));
    
    const clusters: any = {};
    
    reports.forEach(report => {
      const location = report.location as any;
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
// GET /api/v1/map/stats
export const getMapStats = async (req: Request, res: Response) => {
    try {
      const stats = await prisma.report.groupBy({
        by: ['category', 'status'],
        _count: { id: true }
      });
  
      // Fetch reports so we can manually aggregate location stats
      const reports = await prisma.report.findMany({
        select: {
          location: true
        }
      });
  
      // Manual aggregation since Prisma cannot groupby JSON
      const areaMap: Record<string, any> = {};
  
      reports.forEach(r => {
        const loc = r.location as any;
        if (!loc?.lat || !loc?.lng) return;
  
        const key = `${loc.lat}_${loc.lng}`;
  
        if (!areaMap[key]) {
          areaMap[key] = {
            area_name: loc.area_name,
            lat: loc.lat,
            lng: loc.lng,
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
        category_stats: stats,
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