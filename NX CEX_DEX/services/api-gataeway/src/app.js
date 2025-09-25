const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const cluster = require('cluster');
const os = require('os');
require('dotenv').config();

// Cluster mode for high availability
if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);
  
  // Fork workers
  for (let i = 0; i < os.cpus().length; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  const app = express();
  
  // Advanced security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://apis.google.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:", "https:"],
        frameSrc: ["'self'", "https://www.google.com"]
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));

  // CORS configuration
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }));

  // Advanced rate limiting by endpoint type
  const limiterByEndpoint = {
    auth: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts
      message: 'Too many authentication attempts',
      standardHeaders: true
    }),
    trading: rateLimit({
      windowMs: 1000, // 1 second
      max: 50, // 50 requests per second
      message: 'Too many trading requests',
      standardHeaders: true
    }),
    public: rateLimit({
      windowMs: 1000, // 1 second
      max: 100, // 100 requests per second
      message: 'Too many requests',
      standardHeaders: true
    })
  };

  // Speed limiting for API endpoints
  const speedLimiter = slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 100, // allow 100 requests per 15 minutes, then...
    delayMs: 500 // begin adding 500ms of delay per request above 100
  });

  // Apply rate limiting
  app.use('/api/auth', limiterByEndpoint.auth);
  app.use('/api/trading', limiterByEndpoint.trading, speedLimiter);
  app.use('/api/', limiterByEndpoint.public);

  // Body parsing with limits
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // API Routes
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/spot', require('./routes/spot'));
  app.use('/api/futures', require('./routes/futures'));
  app.use('/api/perpetual', require('./routes/perpetual'));
  app.use('/api/stocks', require('./routes/stocks'));
  app.use('/api/launchpad', require('./routes/launchpad'));
  app.use('/api/staking', require('./routes/staking'));
  app.use('/api/lending', require('./routes/lending'));
  app.use('/api/bots', require('./routes/bots'));
  app.use('/api/copy-trading', require('./routes/copy-trading'));
  app.use('/api/p2p', require('./routes/p2p'));
  app.use('/api/payments', require('./routes/payments'));

  // Health checks
  app.get('/health', async (req, res) => {
    const healthCheck = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version,
      worker: process.pid
    };
    
    res.status(200).json(healthCheck);
  });

  // Global error handler
  app.use(require('./middleware/errorHandler'));

  const PORT = process.env.PORT || 80;
  app.listen(PORT, () => {
    console.log(`NEX'EC API Gateway Worker ${process.pid} running on port ${PORT}`);
  });
}
