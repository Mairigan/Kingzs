require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

const database = require('./config/database');
const WebSocketService = require('./services/WebSocketService');

// Route imports
const authRoutes = require('./routes/auth');
const tradingRoutes = require('./routes/trading');
const walletRoutes = require('./routes/wallet');
const marketRoutes = require('./routes/market');

class Application {
  constructor() {
    this.app = express();
    this.server = null;
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());
    
    // CORS configuration
    this.app.use(cors({
      origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      message: {
        success: false,
        error: 'Too many requests from this IP, please try again later.'
      }
    });

    const speedLimiter = slowDown({
      windowMs: 15 * 60 * 1000,
      delayAfter: 50,
      delayMs: 500
    });

    this.app.use(limiter);
    this.app.use(speedLimiter);

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Compression
    this.app.use(compression());

    // Logging
    if (process.env.NODE_ENV !== 'test') {
      this.app.use(morgan('combined'));
    }
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        success: true,
        message: 'NEX\'EC Exchange API is running',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // API routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/trading', tradingRoutes);
    this.app.use('/api/wallet', walletRoutes);
    this.app.use('/api/market', marketRoutes);

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found'
      });
    });
  }

  setupErrorHandling() {
    // Global error handler
    this.app.use((error, req, res, next) => {
      console.error('Unhandled error:', error);

      res.status(error.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : error.message
      });
    });

    // Process handlers
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });
  }

  async start(port = process.env.PORT || 3000) {
    try {
      // Connect to databases
      await database.connectMongo();
      await database.connectRedis();

      // Start HTTP server
      this.server = this.app.listen(port, () => {
        console.log(`🚀 NEX'EC Exchange server running on port ${port}`);
        console.log(`📊 Environment: ${process.env.NODE_ENV}`);
        console.log(`⏰ Started at: ${new Date().toISOString()}`);
      });

      // Initialize WebSocket
      new WebSocketService(this.server);

      return this.server;
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  async stop() {
    if (this.server) {
      this.server.close();
      await database.disconnect();
      console.log('Server stopped gracefully');
    }
  }
}

// Start application if run directly
if (require.main === module) {
  const app = new Application();
  app.start();
}

module.exports = Application;