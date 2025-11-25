import { Router } from 'express';
import { getMapReports, getMapClusters, getMapStats } from '../controllers/mapController';
import { optionalAuthMiddleware } from '../middleware/auth';

const router = Router();

router.get('/reports', optionalAuthMiddleware, getMapReports);
router.get('/clusters', optionalAuthMiddleware, getMapClusters);
router.get('/stats', optionalAuthMiddleware, getMapStats);

export default router;