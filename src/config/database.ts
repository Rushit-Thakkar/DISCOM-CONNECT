import mongoose, { ConnectOptions, Connection } from 'mongoose';
import logger from '../utils/logger';

// MongoDB connection URI
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/meter-reader';

// Connection options
const options: ConnectOptions = {
  // These options are now the default in Mongoose 6+
  // useNewUrlParser: true,
  // useUnifiedTopology: true,
  autoCreate: true,
  autoIndex: true,
  maxPoolSize: 10, // Maintain up to 10 socket connections
  serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  family: 4, // Use IPv4, skip trying IPv6
};

class Database {
  private static instance: Database;
  private connection: typeof mongoose | null = null;

  private constructor() {}

  /**
   * Get database instance (Singleton pattern)
   */
  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  /**
   * Connect to MongoDB
   */
  public async connect(): Promise<typeof mongoose> {
    if (this.connection) {
      return this.connection;
    }

    try {
      logger.info('Connecting to MongoDB...');
      
      this.connection = await mongoose.connect(MONGO_URI, options);
      
      logger.info('MongoDB connected successfully');
      
      // Set up event listeners
      this.setupEventListeners();
      
      return this.connection;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`MongoDB connection error: ${errorMessage}`, { error });
      
      // In case of connection error, retry after 5 seconds
      setTimeout(() => {
        logger.info('Retrying MongoDB connection...');
        this.connect().catch(err => 
          logger.error('Failed to reconnect to MongoDB', { error: err })
        );
      }, 5000);
      
      throw new Error(`MongoDB connection error: ${errorMessage}`);
    }
  }

  /**
   * Close MongoDB connection
   */
  public async disconnect(): Promise<void> {
    if (!this.connection) {
      return;
    }

    try {
      await mongoose.disconnect();
      this.connection = null;
      logger.info('MongoDB disconnected');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Error disconnecting from MongoDB: ${errorMessage}`, { error });
      throw error;
    }
  }

  /**
   * Get database connection status
   */
  public getConnectionStatus(): string {
    return mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  }

  /**
   * Get the native MongoDB driver connection
   */
  public getNativeConnection(): Connection | null {
    return this.connection?.connection || null;
  }

  /**
   * Set up MongoDB event listeners
   */
  private setupEventListeners(): void {
    const { connection } = mongoose;

    connection.on('connected', () => {
      logger.info('MongoDB connected successfully');
    });

    connection.on('error', (error: Error) => {
      logger.error(`MongoDB connection error: ${error.message}`, { error });
    });

    connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    // Close the Mongoose connection when the application is terminated
    process.on('SIGINT', async () => {
      try {
        await this.disconnect();
        process.exit(0);
      } catch (error) {
        logger.error('Error during application shutdown', { error });
        process.exit(1);
      }
    });
  }
}

// Create and export a singleton instance
const database = Database.getInstance();

// Export the database instance and connect function
export { database };

export default database;
