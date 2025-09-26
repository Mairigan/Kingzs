const AuthService = require('../services/AuthService');

const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. No token provided.'
      });
    }

    // Check if token is blacklisted
    if (AuthService.isTokenBlacklisted(token)) {
      return res.status(401).json({
        success: false,
        error: 'Token has been invalidated.'
      });
    }

    const verification = AuthService.verifyToken(token);
    if (!verification.success) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token.'
      });
    }

    req.user = verification.user;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Authentication failed.'
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token && !AuthService.isTokenBlacklisted(token)) {
      const verification = AuthService.verifyToken(token);
      if (verification.success) {
        req.user = verification.user;
      }
    }
    
    next();
  } catch (error) {
    next();
  }
};

module.exports = { authenticate, optionalAuth };