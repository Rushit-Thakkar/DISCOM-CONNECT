import winston from 'winston';
import path from 'path';
import 'winston-daily-rotate-file';
import { format, TransformableInfo } from 'logform';
import { inspect } from 'util';
import { Request, Response } from 'express';

const { combine, timestamp, printf, colorize, align, errors } = format;

// Log directory
const logDir = path.join(process.cwd(), 'logs');

// Log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define log colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

// Add colors to winston
winston.addColors(colors);

// Custom format for console logging
const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }: TransformableInfo) => {
  // Handle error objects
  if (stack) {
    return `${timestamp} ${level}: ${message}\n${stack}`;
  }

  // Handle meta objects
  const metaString = Object.keys(meta).length ? `\n${inspect(meta, { depth: null, colors: true })}` : '';
  return `${timestamp} ${level}: ${message}${metaString}`;
});

// Custom format for file logging
const fileFormat = printf(({ level, message, timestamp, stack, ...meta }: TransformableInfo) => {
  // Handle error objects
  if (stack) {
    return `${timestamp} ${level}: ${message}\n${stack}`;
  }

  // Handle meta objects
  const metaString = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
  return `${timestamp} ${level}: ${message}${metaString}`;
});

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'meter-reader-api' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: combine(colorize({ all: true }), consoleFormat),
    }),
    // Daily rotate file transport for all logs
    new winston.transports.DailyRotateFile({
      dirname: path.join(logDir, 'all'),
      filename: 'application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: fileFormat,
    }),
    // Error logs
    new winston.transports.DailyRotateFile({
      level: 'error',
      dirname: path.join(logDir, 'error'),
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      format: fileFormat,
    }),
    // HTTP request logs
    new winston.transports.DailyRotateFile({
      level: 'http',
      dirname: path.join(logDir, 'http'),
      filename: 'http-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: fileFormat,
    }),
  ],
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'exceptions.log'),
      format: fileFormat,
    }),
  ],
  // Handle unhandled rejections
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'rejections.log'),
      format: fileFormat,
    }),
  ],
  // Exit on error, set to false to continue logging after an unhandled exception
  exitOnError: false,
});

// If we're not in production, log to the console with colorization
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: combine(colorize({ all: true }), consoleFormat),
    })
  );
}

// Add a stream that can be used by morgan for HTTP request logging
export const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

// Helper function to log HTTP requests
export const httpLogger = (req: Request, res: Response, next: Function) => {
  // Log the request
  logger.http(`${req.method} ${req.originalUrl}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    query: Object.keys(req.query).length ? req.query : undefined,
    params: Object.keys(req.params).length ? req.params : undefined,
    body: req.body && Object.keys(req.body).length ? req.body : undefined,
  });

  // Log the response
  const originalSend = res.send;
  res.send = function (body) {
    logger.http(`Response for ${req.method} ${req.originalUrl}`, {
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      response: body,
    });
    return originalSend.call(this, body);
  };

  next();
};

export default logger;
