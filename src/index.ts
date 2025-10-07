import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import xss from 'xss-clean';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { createTerminus } from '@godaddy/terminus';
import { database } from './config/database';
import userRoutes from './routes/user.routes';
import meterRoutes from './routes/meter.routes';
import { errorHandler, AppError } from './middleware/error.middleware';
import logger from './utils/logger';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Initialize express app
const app: Application = express();
const server = createServer(app);

// Set security HTTP headers
app.use(helmet());

// Enable CORS
const corsOptions = {
  origin: process.env.CLIENT_URL?.split(',') || ['http://localhost:19006'],
  credentials: true,
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
};
app.use(cors(corsOptions));

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Cookie parser
app.use(cookieParser());

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Prevent parameter pollution
app.use(
  hpp({
    whitelist: [
      'duration',
      'ratingsQuantity',
      'ratingsAverage',
      'maxGroupSize',
      'difficulty',
      'price',
    ],
  })
);

// Rate limiting
const limiter = rateLimit({
  max: 100, // limit each IP to 100 requests per windowMs
  windowMs: 60 * 60 * 1000, // 1 hour
  message: 'Too many requests from this IP, please try again in an hour!',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Compress all responses
const shouldCompress = (req: Request, res: Response): boolean => {
  if (req.headers['x-no-compression']) {
    // don't compress responses with this request header
    return false;
  }
  // fallback to standard filter function
  return compression.filter(req, res) as boolean;
};

app.use(compression({ filter: shouldCompress }));

// Add request logging in development
if (process.env.NODE_ENV === 'development') {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.originalUrl}`, {
      query: req.query,
      body: req.body,
      headers: req.headers,
    });
    next();
  });
}

// Socket.IO setup with proper types
interface UserSocket extends Socket {
  userId?: string;
}

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL?.split(',') || ['http://localhost:19006'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000, // Increase ping timeout to 60 seconds
  pingInterval: 25000, // Send pings every 25 seconds
});

// Store connected users with proper typing
const users = new Map<string, string>();

io.on('connection', (socket: UserSocket) => {
  logger.info(`New socket connection: ${socket.id}`);

  // Handle user authentication
  socket.on('authenticate', (userId: string) => {
    if (typeof userId === 'string') {
      users.set(userId, socket.id);
      socket.userId = userId;
      logger.info(`User ${userId} authenticated with socket ${socket.id}`);
      
      // Notify user of successful authentication
      socket.emit('authenticated', { success: true, userId });
    }
  });

  // Handle location updates with proper typing
  interface LocationData {
    userId: string;
    location: {
      lat: number;
      lng: number;
    };
  }

  socket.on('locationUpdate', (data: LocationData) => {
    if (data && data.userId && data.location) {
      // Broadcast to all connected clients (or just to admin users)
      io.emit('userLocationUpdate', data);
    }
  });

  socket.on('disconnect', () => {
    // Remove user from the map when they disconnect
    if (socket.userId) {
      users.delete(socket.userId);
      console.log(`User ${socket.userId} disconnected`);
    }
  });
});

// API Routes
app.use('/api/users', userRoutes);
app.use('/api/meters', meterRoutes);


// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: database.getConnectionStatus(),
  });
});

// 404 handler - must be after all other routes
app.all('*', (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Error handling middleware - must be after all other middleware and routes
app.use(errorHandler);

// Server configuration
const PORT = process.env.PORT || 5001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Graceful shutdown configuration
const onSignal = async (): Promise<void> => {
  logger.info('Server is starting cleanup');
  try {
    await database.disconnect();
    logger.info('MongoDB connection closed');
  } catch (error) {
    logger.error('Error during cleanup', { error });
    throw error;
  }
};

const onShutdown = (): Promise<void> => {
  logger.info('Server is shutting down');
  return Promise.resolve();
};

const onHealthCheck = async (): Promise<Record<string, any>> => {
  const dbStatus = database.getConnectionStatus();
  
  // Check if database connection is healthy
  const dbHealthy = dbStatus === 'connected';
  const status = dbHealthy ? 'ok' : 'error';
  
  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbStatus,
  };
};

// Create terminus instance for graceful shutdown
createTerminus(server, {
  signal: 'SIGINT',
  healthChecks: { '/healthcheck': onHealthCheck },
  onSignal,
  onShutdown,
  logger: (msg: string, err?: Error) => {
    if (err) {
      logger.error(msg, { error: err });
    } else {
      logger.info(msg);
    }
  },
});

// Start server
const startServer = async (): Promise<void> => {
  try {
    // Connect to database
    await database.connect();
    
    // Start listening
    server.listen(PORT, () => {
      logger.info(`Server running in ${NODE_ENV} mode on port ${PORT}`);
      
      // Log environment information
      logger.info('Server environment:', {
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: process.memoryUsage(),
        env: NODE_ENV,
      });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught Exception:', error);
      // Attempt a graceful shutdown
      server.close(() => {
        process.exit(1);
      });
    });
    
  } catch (error) {
    logger.error('Failed to start server:', { error });
    process.exit(1);
  }
};

// Start the server
startServer().catch((error) => {
  logger.error('Fatal error during server startup:', { error });
  process.exit(1);
});

export { io, app, server };