"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMapStats = exports.getMapClusters = exports.getMapReports = void 0;
const postgres_1 = require("../config/postgres");
// GET /api/v1/map/reports
const getMapReports = async (req, res) => {
    try {
        const { bounds, // "lat1,lng1,lat2,lng2"
        category, status, limit = 100 } = req.query;
        let whereClause = 'WHERE 1=1';
        const params = [];
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
            const [southWestLat, southWestLng, northEastLat, northEastLng] = bounds.split(',').map(parseFloat);
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
        params.push(parseInt(limit));
        const result = await postgres_1.pool.query(sql, params);
        const reports = result.rows;
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
    }
    catch (error) {
        console.error('Get map reports error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch map data' },
        });
    }
};
exports.getMapReports = getMapReports;
// GET /api/v1/map/clusters (for handling many points)
const getMapClusters = async (req, res) => {
    try {
        const { zoom, bounds } = req.query;
        // Simple clustering - get reports
        const reportsResult = await postgres_1.pool.query(`
      SELECT id, location, category, status 
      FROM reports 
      LIMIT 500
    `);
        const reports = reportsResult.rows;
        // Simple clustering by rounding coordinates
        const clusterZoom = parseInt(zoom) || 10;
        const precision = Math.pow(10, Math.floor(clusterZoom / 3));
        const clusters = {};
        reports.forEach(report => {
            const location = report.location ? JSON.parse(report.location) : {};
            if (!location?.lat || !location?.lng)
                return;
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
        const clusterData = Object.values(clusters).map((cluster) => ({
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
    }
    catch (error) {
        console.error('Get map clusters error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch cluster data' },
        });
    }
};
exports.getMapClusters = getMapClusters;
// GET /api/v1/map/stats
const getMapStats = async (req, res) => {
    try {
        // Get category and status stats
        const categoryStatsResult = await postgres_1.pool.query(`
      SELECT category, status, COUNT(*) as count 
      FROM reports 
      GROUP BY category, status
    `);
        const categoryStats = categoryStatsResult.rows;
        // Fetch reports for location stats
        const reportsResult = await postgres_1.pool.query('SELECT location FROM reports');
        const reports = reportsResult.rows;
        // Manual aggregation for location stats
        const areaMap = {};
        reports.forEach(report => {
            const location = report.location ? JSON.parse(report.location) : {};
            if (!location?.lat || !location?.lng)
                return;
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
            .sort((a, b) => b.count - a.count)
            .slice(0, 50);
        return res.status(200).json({
            category_stats: categoryStats,
            hotspot_areas: areaStats.map((a) => ({
                area_name: a.area_name,
                report_count: a.count,
                coordinates: {
                    lat: a.lat,
                    lng: a.lng
                }
            }))
        });
    }
    catch (error) {
        console.error('Get map stats error:', error);
        res.status(500).json({
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch map stats' },
        });
    }
};
exports.getMapStats = getMapStats;
// Helper functions for map styling
function getStatusColor(status) {
    const colors = {
        'pending': '#F59E0B', // Amber
        'community_verified': '#3B82F6', // Blue
        'assigned': '#8B5CF6', // Purple
        'resolved': '#10B981', // Green
        'flagged': '#EF4444', // Red
        'duplicate': '#6B7280' // Gray
    };
    return colors[status] || '#6B7280';
}
function getCategoryIcon(category) {
    const icons = {
        'garbage': '🗑️',
        'road': '🛣️',
        'water': '💧',
        'tree': '🌳',
        'electricity': '⚡',
        'other': '📍'
    };
    return icons[category] || '📍';
}
