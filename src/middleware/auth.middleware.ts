import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import ErrorResponse from '../utils/errorResponse';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: 'user' | 'admin';
        name?: string;
        email?: string;
      };
    }
  }
}

export interface AuthRequest extends Request {}

// Protect routes
export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not defined');
      }

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET) as { id: string };

      // Get user from the token
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return next(new ErrorResponse('User not found', 404));
      }

      req.user = {
        id: user._id.toString(),
        role: user.role as 'user' | 'admin',
        name: user.name,
        email: user.email
      };

      next();
    } catch (error) {
      console.error('Authentication error:', error);
      return next(new ErrorResponse('Not authorized, token failed', 401));
    }
  }

  if (!token) {
    return next(new ErrorResponse('Not authorized, no token', 401));
  }
};

// Grant access to specific roles
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new ErrorResponse(
          `User role ${req.user?.role || 'unknown'} is not authorized to access this route`,
          403
        )
      );
    }
    next();
  };
};
