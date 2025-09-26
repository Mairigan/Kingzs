const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  tradeId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  symbol: {
    type: String,
    required: true,
    uppercase: true,
    index: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  side: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  takerOrderId: {
    type: String,
    required: true,
    index: true
  },
  makerOrderId: {
    type: String,
    required: true,
    index: true
  },
  takerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  makerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fee: {
    makerFee: { type: Number, default: 0 },
    takerFee: { type: Number, default: 0 },
    feeCurrency: { type: String, default: 'USDT' }
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
tradeSchema.index({ symbol: 1, timestamp: -1 });
tradeSchema.index({ takerUserId: 1, timestamp: -1 });
tradeSchema.index({ makerUserId: 1, timestamp: -1 });

// Virtual for total value
tradeSchema.virtual('totalValue').get(function() {
  return this.price * this.quantity;
});

// Static method to get recent trades
tradeSchema.statics.getRecentTrades = function(symbol, limit = 100) {
  return this.find({ symbol })
    .sort({ timestamp: -1 })
    .limit(limit)
    .populate('takerUserId', 'email name')
    .populate('makerUserId', 'email name');
};

const Trade = mongoose.model('Trade', tradeSchema);

module.exports = Trade;