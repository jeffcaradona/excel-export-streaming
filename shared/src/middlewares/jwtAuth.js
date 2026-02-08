/**
 * JWT Authentication Middleware
 * 
 * Validates JWT tokens in the Authorization header for API endpoints.
 * Ensures only authenticated requests from the App service are processed.
 */

import { verifyToken } from '../auth/jwt.js';

/**
 * Create JWT authentication middleware
 * 
 * @param {string} secret - JWT secret key from environment
 * @returns {Function} Express middleware function
 * 
 * @example
 * import { jwtAuthMiddleware } from 'excel-export-streaming-shared/middlewares/jwtAuth';
 * 
 * router.use(jwtAuthMiddleware(process.env.JWT_SECRET));
 */
export function jwtAuthMiddleware(secret) {
  return (req, res, next) => {
    try {
      // Extract Authorization header
      const authHeader = req.headers.authorization;
      
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({
          error: {
            message: 'Missing or invalid authorization header',
            code: 'UNAUTHORIZED'
          }
        });
      }

      // Extract token (remove 'Bearer ' prefix)
      const token = authHeader.substring(7);
      
      // Verify token and attach decoded payload to request
      const decoded = verifyToken(token, secret);
      req.auth = decoded;
      
      next();
    } catch (error) {
      // Handle specific JWT errors
      let message = null;
      
      if (error.name === 'TokenExpiredError') {
        message = 'Token expired';
      } else if (error.name === 'JsonWebTokenError') {
        message = 'Invalid token';
      }
      
      res.status(401).json({
        error: {
          message,
          code: 'UNAUTHORIZED'
        }
      });
    }
  };
}
