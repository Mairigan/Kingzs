const mongoose = require('mongoose');
const redis = require('redis');

class Database {
  constructor() {
    this.mongoConnection = null;
    this.redisClient = null;
  }

  async connectMongo() {
    try {
      this.mongoConnection = await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      
      console.log('✅ MongoDB connected successfully');
      
      mongoose.connection.on('error', (err) => {
        console.error('MongoDB connection error:', err);
      });
      
      mongoose.connection.on('disconnected', () => {
        console.log('MongoDB disconnected');
      });
      
    } catch (error) {
      console.error('MongoDB connection failed:', error);
      process.exit(1);
    }
  }

  async connectRedis() {
    try {
      this.redisClient = redis.createClient({
        url: process.env.REDIS_URL
      });

      this.redisClient.on('error', (err) => {
        console.error('Redis Client Error:', err);
      });

      this.redisClient.on('connect', () => {
        console.log('✅ Redis connected successfully');
      });

      await this.redisClient.connect();
      
    } catch (error) {
      console.error('Redis connection failed:', error);
      process.exit(1);
    }
  }

  async disconnect() {
    if (this.mongoConnection) {
      await mongoose.disconnect();
    }
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }
}

module.exports = new Database();