import { Router } from 'express';
import { 
  signup, 
  login, 
  refreshTokenHandler 
} from '../controllers/authController-sqlite';

const router = Router();

// SQLite endpoints
router.post('/signup', signup);
router.post('/login', login);
router.post('/refresh', refreshTokenHandler);

export default router;