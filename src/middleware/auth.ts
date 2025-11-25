import { Request, Response, NextFunction } from 'express';
   import { verifyAccessToken } from '../utils/jwt';

   declare global {
     namespace Express {
       interface Request {
         userId?: string;
         userEmail?: string;
       }
     }
   }

   export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
     const authHeader = req.headers.authorization;

     if (!authHeader || !authHeader.startsWith('Bearer ')) {
       return res.status(401).json({
         error: {
           code: 'UNAUTHORIZED',
           message: 'Missing or invalid authorization header',
         },
       });
     }

     const token = authHeader.substring(7);
     const payload = verifyAccessToken(token);

     if (!payload) {
       return res.status(401).json({
         error: {
           code: 'UNAUTHORIZED',
           message: 'Invalid or expired token',
         },
       });
     }

     req.userId = payload.sub;
     req.userEmail = payload.email;
     next();
   };

   export const optionalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
     const authHeader = req.headers.authorization;

     if (authHeader && authHeader.startsWith('Bearer ')) {
       const token = authHeader.substring(7);
       const payload = verifyAccessToken(token);
       if (payload) {
         req.userId = payload.sub;
         req.userEmail = payload.email;
       }
     }

     next();
   };