import { Router, Request, Response } from 'express';
import { 
  signup, 
  login, 
  refreshTokenHandler,
  googleAuth,
  getGoogleClientId
} from '../controllers/authController';

const router = Router();

// POST routes
router.post('/signup', signup);
router.post('/login', login);
router.post('/refresh', refreshTokenHandler);
router.post('/google', googleAuth);
router.get('/google/client-id', getGoogleClientId);

// Handle GET requests to auth routes with helpful error message
router.get('/signup', (req: Request, res: Response) => {
  res.status(405).json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Signup endpoint requires POST method. Use POST /api/v1/auth/signup',
      method: 'POST',
      endpoint: '/api/v1/auth/signup'
    }
  });
});

router.get('/login', (req: Request, res: Response) => {
  res.status(405).json({
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Login endpoint requires POST method. Use POST /api/v1/auth/login',
      method: 'POST',
      endpoint: '/api/v1/auth/login'
    }
  });
});

export default router;