const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  symbol: {
    type: String,
    required: true,
    uppercase: true,
    index: true
  },
  type: {
    type: String,
    enum: ['limit', 'market', 'stop_limit', 'stop_market'],
    required: true
  },
  side: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  price: {
    type: Number,
    min: 0,
    required: function() {
      return this.type === 'limit' || this.type === 'stop_limit';
    }
  },
  stopPrice: {
    type: Number,
    min: 0,
    required: function() {
      return this.type.includes('stop');
    }
  },
  filledQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  averageFillPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['open', 'partially_filled', 'filled', 'cancelled', 'rejected'],
    default: 'open'
  },
  timeInForce: {
    type: String,
    enum: ['GTC', 'IOC', 'FOK'],
    default: 'GTC'
  },
  leverage: {
    type: Number,
    default: 1,
    min: 1,
    max: 100
  },
  reduceOnly: {
    type: Boolean,
    default: false
  },
  postOnly: {
    type: Boolean,
    default: false
  },
  clientOrderId: {
    type: String,
    index: true
  }
}, {
  timestamps: true
});

// Virtual for remaining quantity
orderSchema.virtual('remainingQuantity').get(function() {
  return this.quantity - this.filledQuantity;
});

// Virtual for total value
orderSchema.virtual('totalValue').get(function() {
  return this.quantity * (this.price || 0);
});

// Index for efficient queries
orderSchema.index({ userId: 1, status: 1 });
orderSchema.index({ symbol: 1, status: 1 });
orderSchema.index({ createdAt: 1 });

// Pre-save middleware
orderSchema.pre('save', function(next) {
  if (this.filledQuantity >= this.quantity) {
    this.status = 'filled';
  } else if (this.filledQuantity > 0) {
    this.status = 'partially_filled';
  }
  next();
});

// Method to fill order
orderSchema.methods.fill = function(quantity, price) {
  const fillQty = Math.min(quantity, this.remainingQuantity);
  this.filledQuantity += fillQty;
  
  // Update average fill price
  this.averageFillPrice = (
    (this.averageFillPrice * (this.filledQuantity - fillQty)) + 
    (price * fillQty)
  ) / this.filledQuantity;
  
  return fillQty;
};

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;