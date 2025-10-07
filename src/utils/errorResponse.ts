class ErrorResponse extends Error {
  statusCode: number;
  code?: number;
  errors?: any;
  value?: string;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ErrorResponse);
    }

    this.name = this.constructor.name;
  }

  // Static method to create a new ErrorResponse
  static create(message: string, statusCode: number): ErrorResponse {
    return new ErrorResponse(message, statusCode);
  }

  // Format validation errors
  static fromValidationError(error: any): ErrorResponse {
    const message = 'Validation failed';
    const err = new ErrorResponse(message, 400);
    err.errors = error.errors;
    return err;
  }

  // Format MongoDB duplicate key error
  static fromMongoError(error: any): ErrorResponse {
    let message = 'Database error';
    let statusCode = 500;

    // Handle duplicate field value
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      message = `Duplicate field value: ${field}. Please use another value`;
      statusCode = 400;
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((val: any) => val.message);
      message = messages.join(', ');
      statusCode = 400;
    }

    // Handle cast errors (invalid ObjectId, etc.)
    if (error.name === 'CastError') {
      message = `Resource not found`;
      statusCode = 404;
    }

    return new ErrorResponse(message, statusCode);
  }

  // Format JWT errors
  static fromJWTError(error: any): ErrorResponse {
    let message = 'Authentication error';
    let statusCode = 401;

    if (error.name === 'JsonWebTokenError') {
      message = 'Invalid token';
    } else if (error.name === 'TokenExpiredError') {
      message = 'Token expired';
    }

    return new ErrorResponse(message, statusCode);
  }
}

export default ErrorResponse;
