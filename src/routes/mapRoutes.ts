import { Router } from 'express';
import { 
  getMapReports, 
  getMapClusters, 
  getMapStats 
} from '../controllers/mapController-sqlite';

const router = Router();

// SQLite endpoints
router.get('/reports', getMapReports);
router.get('/clusters', getMapClusters);
router.get('/stats', getMapStats);

export default router;