const jwt = require('jsonwebtoken');
const User = require('../models/User');
const crypto = require('crypto');

class AuthService {
  constructor() {
    this.blacklistedTokens = new Set();
  }

  async register(userData) {
    try {
      // Check if user already exists
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser) {
        throw new Error('User already exists with this email');
      }

      // Create new user
      const user = new User({
        email: userData.email,
        password: userData.password,
        name: userData.name
      });

      await user.save();

      // Create wallet for user
      const wallet = new Wallet({
        userId: user._id,
        balances: [
          { currency: 'USDT', available: 1000 }, // Demo balance
          { currency: 'BTC', available: 0.01 }   // Demo balance
        ]
      });
      await wallet.save();

      // Generate auth token
      const token = user.generateAuthToken();

      return {
        success: true,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          isVerified: user.isVerified
        },
        token
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async login(email, password, ipAddress, userAgent) {
    try {
      const user = await User.findOne({ email }).select('+password');
      
      if (!user) {
        throw new Error('Invalid email or password');
      }

      // Check if account is locked
      if (user.isLocked) {
        const remainingTime = Math.ceil((user.lockUntil - Date.now()) / 1000 / 60);
        throw new Error(`Account temporarily locked. Try again in ${remainingTime} minutes.`);
      }

      // Check password
      const isPasswordValid = await user.checkPassword(password);
      if (!isPasswordValid) {
        await user.incrementLoginAttempts();
        throw new Error('Invalid email or password');
      }

      // Reset login attempts on successful login
      await User.updateOne(
        { _id: user._id },
        { 
          $set: { loginAttempts: 0 },
          $unset: { lockUntil: 1 },
          lastLogin: new Date()
        }
      );

      // Record device info
      await this.recordDevice(user._id, ipAddress, userAgent);

      // Generate token
      const token = user.generateAuthToken();

      return {
        success: true,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          isVerified: user.isVerified,
          kycStatus: user.kycStatus
        },
        token
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async recordDevice(userId, ipAddress, userAgent) {
    const deviceId = crypto.createHash('md5').update(userAgent + ipAddress).digest('hex');
    
    await User.updateOne(
      { _id: userId, 'devices.deviceId': { $ne: deviceId } },
      {
        $push: {
          devices: {
            deviceId,
            userAgent,
            ipAddress,
            lastUsed: new Date()
          }
        }
      }
    );
  }

  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return { success: true, user: decoded };
    } catch (error) {
      return { success: false, error: 'Invalid token' };
    }
  }

  blacklistToken(token) {
    this.blacklistedTokens.add(token);
    
    // Remove token from blacklist after expiration
    setTimeout(() => {
      this.blacklistedTokens.delete(token);
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  isTokenBlacklisted(token) {
    return this.blacklistedTokens.has(token);
  }

  async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findById(userId).select('+password');
      
      if (!user) {
        throw new Error('User not found');
      }

      const isCurrentValid = await user.checkPassword(currentPassword);
      if (!isCurrentValid) {
        throw new Error('Current password is incorrect');
      }

      user.password = newPassword;
      await user.save();

      return { success: true };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new AuthService();