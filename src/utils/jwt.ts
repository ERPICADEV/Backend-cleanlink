import jwt from 'jsonwebtoken';

   interface TokenPayload {
     sub: string; // user ID
     email?: string;
     iat?: number;
   }

   const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

   export const generateAccessToken = (userId: string, email?: string): string => {
     return jwt.sign({ sub: userId, email }, JWT_SECRET, {
       expiresIn: '1h',
       issuer: 'cleanlink',
       algorithm: 'HS256',
     });
   };

   export const generateRefreshToken = (userId: string): string => {
     return jwt.sign({ sub: userId }, JWT_SECRET, {
       expiresIn: '7d',
       issuer: 'cleanlink',
       algorithm: 'HS256',
     });
   };

   export const verifyAccessToken = (token: string): TokenPayload | null => {
     try {
       return jwt.verify(token, JWT_SECRET, {
         algorithms: ['HS256'],
       }) as TokenPayload;
     } catch (error) {
       return null;
     }
   };

   export const verifyRefreshToken = (token: string): TokenPayload | null => {
     try {
       return jwt.verify(token, JWT_SECRET, {
         algorithms: ['HS256'],
       }) as TokenPayload;
     } catch (error) {
       return null;
     }
   };
