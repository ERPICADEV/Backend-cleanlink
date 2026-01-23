"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMapStats = exports.getMapClusters = exports.getMapReports = void 0;
const postgres_1 = require("../config/postgres");
const dbErrorHandler_1 = require("../utils/dbErrorHandler");
const databaseRetry_1 = require("../utils/databaseRetry");
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
        upvotes, downvotes, created_at, ai_score, reporter_display,
        COALESCE(json_array_length(NULLIF(images, '')::json), 0) as image_count
      FROM reports 
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}
    `;
        params.push(parseInt(limit));
        // Use retry logic for database queries to handle transient connection issues
        // Increased retries and delays for Render (database may be sleeping)
        const isRender = process.env.RENDER || process.env.DATABASE_URL?.includes('render.com') || process.env.DATABASE_URL?.includes('onrender.com');
        const result = await (0, databaseRetry_1.withRetry)(() => postgres_1.pool.query(sql, params), isRender ? 5 : 3, // More retries for Render
        isRender ? 2000 : 1000 // Longer initial delay for Render (database wake-up time)
        );
        const reports = result.rows;
        // Format for map consumption
        const mapData = reports.map(report => {
            // In this codebase schema.sql stores these JSON blobs as TEXT (e.g. '{}' / '[]').
            // In some deployments they may be JSON/JSONB already. Normalize here.
            const location = typeof report.location === 'string'
                ? safeJsonParse(report.location, {})
                : (report.location || {});
            const aiScore = typeof report.ai_score === 'string'
                ? safeJsonParse(report.ai_score, {})
                : (report.ai_score || {});
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
                    image_count: parseInt(report.image_count) || 0,
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
        const errorResponse = (0, dbErrorHandler_1.handleDatabaseError)(error, 'Failed to fetch map data');
        if (errorResponse.status === 503) {
            console.warn('⚠️  Database connection error in getMapReports');
            // Additional logging for connection errors
            console.error('Full error object:', {
                code: error?.code,
                message: error?.message,
                name: error?.name,
                errno: error?.errno,
                syscall: error?.syscall
            });
        }
        else {
            console.error('Get map reports error:', error);
        }
        res.status(errorResponse.status).json(errorResponse.error);
    }
};
exports.getMapReports = getMapReports;
// GET /api/v1/map/clusters (for handling many points)
const getMapClusters = async (req, res) => {
    try {
        const { zoom, bounds } = req.query;
        // Simple clustering - get reports
        // Use retry logic for database queries to handle transient connection issues
        const isRender = process.env.RENDER || process.env.DATABASE_URL?.includes('render.com') || process.env.DATABASE_URL?.includes('onrender.com');
        const reportsResult = await (0, databaseRetry_1.withRetry)(() => postgres_1.pool.query(`
        SELECT id, location, category, status 
        FROM reports 
        LIMIT 500
      `), isRender ? 5 : 3, isRender ? 2000 : 1000);
        const reports = reportsResult.rows;
        // Simple clustering by rounding coordinates
        const clusterZoom = parseInt(zoom) || 10;
        const precision = Math.pow(10, Math.floor(clusterZoom / 3));
        const clusters = {};
        reports.forEach(report => {
            const location = report.location || {};
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
        const errorResponse = (0, dbErrorHandler_1.handleDatabaseError)(error, 'Failed to fetch cluster data');
        if (errorResponse.status === 503) {
            console.warn('⚠️  Database connection error in getMapClusters');
        }
        else {
            console.error('Get map clusters error:', error);
        }
        res.status(errorResponse.status).json(errorResponse.error);
    }
};
exports.getMapClusters = getMapClusters;
// GET /api/v1/map/stats
const getMapStats = async (req, res) => {
    try {
        // Use retry logic for database queries to handle transient connection issues
        const isRender = process.env.RENDER || process.env.DATABASE_URL?.includes('render.com') || process.env.DATABASE_URL?.includes('onrender.com');
        // Get category and status stats
        const categoryStatsResult = await (0, databaseRetry_1.withRetry)(() => postgres_1.pool.query(`
        SELECT category, status, COUNT(*) as count 
        FROM reports 
        GROUP BY category, status
      `), isRender ? 5 : 3, isRender ? 2000 : 1000);
        const categoryStats = categoryStatsResult.rows;
        // Fetch reports for location stats
        const reportsResult = await (0, databaseRetry_1.withRetry)(() => postgres_1.pool.query('SELECT location FROM reports'), isRender ? 5 : 3, isRender ? 2000 : 1000);
        const reports = reportsResult.rows;
        // Manual aggregation for location stats
        const areaMap = {};
        reports.forEach(report => {
            const location = report.location || {};
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
        const errorResponse = (0, dbErrorHandler_1.handleDatabaseError)(error, 'Failed to fetch map stats');
        if (errorResponse.status === 503) {
            console.warn('⚠️  Database connection error in getMapStats');
        }
        else {
            console.error('Get map stats error:', error);
        }
        res.status(errorResponse.status).json(errorResponse.error);
    }
};
exports.getMapStats = getMapStats;
function safeJsonParse(value, fallback) {
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
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
