import { Router } from 'express';
import { 
  getMapReports, 
  getMapClusters, 
  getMapStats 
} from '../controllers/mapController';

const router = Router();

router.get('/reports', getMapReports);
router.get('/clusters', getMapClusters);
router.get('/stats', getMapStats);

export default router;