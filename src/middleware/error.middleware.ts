import { Request, Response, NextFunction } from 'express';
import { ValidationError as JoiValidationError } from 'joi';
import { Error as MongooseError, Error } from 'mongoose';
import logger from '../utils/logger';

// Extended error interface for better type safety
export interface IAppError extends Error {
  statusCode?: number;
  code?: number | string;
  errors?: Record<string, { message: string }>;
  keyValue?: Record<string, any>;
  status?: string | number;
  isOperational?: boolean;
  path?: string;
  value?: string;
}

// Custom error class for operational errors (known errors)
export class AppError extends Error implements IAppError {
  statusCode: number;
  status: string;
  isOperational: boolean;
  code?: number | string;
  errors?: Record<string, { message: string }>;
  keyValue?: Record<string, any>;
  path?: string;
  value?: string;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    // Capture stack trace, excluding constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }
}

// Handle Joi validation errors
const handleJoiValidationError = (err: JoiValidationError): AppError => {
  const errors = err.details.map((el: { message: string }) => el.message).join('; ');
  const message = `Invalid input data: ${errors}`;
  return new AppError(message, 400);
};

// Handle MongoDB cast errors (invalid ID format)
const handleCastErrorDB = (err: IAppError): AppError => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400);
};

// Handle MongoDB duplicate key errors
const handleDuplicateFieldsDB = (err: IAppError): AppError => {
  const value = err.keyValue ? Object.values(err.keyValue)[0] : 'unknown';
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400);
};

// Handle MongoDB validation errors
const handleValidationErrorDB = (err: MongooseError.ValidationError): AppError => {
  const errors = Object.values(err.errors).map((el: { message: string }) => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

// Handle JWT errors
const handleJWTError = (): AppError =>
  new AppError('Invalid token. Please log in again!', 401);

const handleJWTExpiredError = (): AppError =>
  new AppError('Your token has expired! Please log in again.', 401);

// Type guard to check if error is IAppError
function isAppError(error: unknown): error is IAppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    (typeof (error as IAppError).statusCode === 'number' || 
     (error as IAppError).statusCode === undefined)
  );
}

// Error handling middleware
const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction // Prefix with underscore to indicate it's intentionally unused
): void => {
    // Convert unknown error to a consistent format
  const error: IAppError = {
    name: (err as Error)?.name || 'Error',
    message: (err as Error)?.message || 'An unknown error occurred',
    statusCode: isAppError(err) && err.statusCode ? err.statusCode : 500,
    status: (isAppError(err) && err.status) || 'error',
    isOperational: isAppError(err) ? err.isOperational || false : false,
  };
  
  // Ensure statusCode is always a number
  if (error.statusCode === undefined) {
    error.statusCode = 500;
  }

  // Preserve stack trace if available
  if ((err as Error)?.stack) {
    error.stack = (err as Error).stack;
  }

  // Log error in development
  if (process.env.NODE_ENV === 'development') {
    logger.error('Error 💥', {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
        statusCode: error.statusCode,
        isOperational: error.isOperational,
      },
      request: {
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        body: req.body,
        query: req.query,
        params: req.params,
      },
    });
  } else if (process.env.NODE_ENV === 'production') {
    // Ensure we have a valid status code
    const statusCode = error.statusCode || 500;
    let productionError: AppError = new AppError(error.message, statusCode);

    // Handle specific error types in production
    if (err instanceof MongooseError.CastError) {
      productionError = handleCastErrorDB({
        ...error,
        path: err.path,
        value: err.value,
        message: err.message,
      });
    } else if ((err as any)?.code === 11000) {
      productionError = handleDuplicateFieldsDB({
        ...error,
        keyValue: (err as any).keyValue,
      });
    } else if (err instanceof MongooseError.ValidationError) {
      productionError = handleValidationErrorDB(err);
} else if (err && typeof err === 'object' && 'name' in err && err.name === 'JsonWebTokenError') {
      productionError = handleJWTError();
} else if (err && typeof err === 'object' && 'name' in err && err.name === 'TokenExpiredError') {
      productionError = handleJWTExpiredError();
    } else if (err instanceof JoiValidationError) {
      productionError = handleJoiValidationError(err);
    }

    // Update the error with the processed production error
    error.statusCode = productionError.statusCode;
    error.status = productionError.status;
    error.message = productionError.message;
  }
  
  // Ensure we have a valid status code for the response
  const responseStatusCode = error.statusCode || 500;
  
  // Send error response
  res.status(responseStatusCode).json({
    success: false,
    error: error.message || 'Server Error',
  });
};

export default errorHandler;
