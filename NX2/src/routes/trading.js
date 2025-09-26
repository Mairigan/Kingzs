const express = require('express');
const TradingEngine = require('../services/TradingEngine');
const Order = require('../models/Order');
const Wallet = require('../models/Wallet');
const { authenticate } = require('../middleware/auth');
const { orderValidation } = require('../middleware/validation');

const router = express.Router();

// Place new order
router.post('/order', authenticate, orderValidation, async (req, res) => {
  try {
    const orderData = {
      ...req.body,
      userId: req.user.userId
    };

    const result = await TradingEngine.placeOrder(orderData);
    
    res.json({
      success: true,
      orderId: result.order.orderId,
      status: result.order.status,
      filled: result.filled
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Get user orders
router.get('/orders', authenticate, async (req, res) => {
  try {
    const { symbol, status, limit = 50, page = 1 } = req.query;
    
    const filter = { userId: req.user.userId };
    if (symbol) filter.symbol = symbol.toUpperCase();
    if (status) filter.status = status;

    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Cancel order
router.delete('/order/:orderId', authenticate, async (req, res) => {
  try {
    const order = await Order.findOne({ 
      orderId: req.params.orderId, 
      userId: req.user.userId 
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    if (order.status !== 'open') {
      return res.status(400).json({
        success: false,
        error: 'Only open orders can be cancelled'
      });
    }

    order.status = 'cancelled';
    await order.save();

    // Return locked funds to available balance
    const [baseCurrency] = order.symbol.split('/');
    await Wallet.updateOne(
      { userId: req.user.userId },
      { 
        $inc: {
          [`balances.$[elem].available`]: order.remainingQuantity,
          [`balances.$[elem].locked`]: -order.remainingQuantity
        }
      },
      {
        arrayFilters: [{ 'elem.currency': baseCurrency }]
      }
    );

    res.json({
      success: true,
      message: 'Order cancelled successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get user trades
router.get('/trades', authenticate, async (req, res) => {
  try {
    const { symbol, limit = 50, page = 1 } = req.query;
    
    const filter = {
      $or: [
        { takerUserId: req.user.userId },
        { makerUserId: req.user.userId }
      ]
    };
    
    if (symbol) filter.symbol = symbol.toUpperCase();

    const trades = await Trade.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('takerUserId', 'email name')
      .populate('makerUserId', 'email name');

    const total = await Trade.countDocuments(filter);

    res.json({
      success: true,
      trades,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;