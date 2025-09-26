const mongoose = require('mongoose');

const balanceSchema = new mongoose.Schema({
  currency: {
    type: String,
    required: true,
    uppercase: true
  },
  available: {
    type: Number,
    default: 0,
    min: 0
  },
  locked: {
    type: Number,
    default: 0,
    min: 0
  },
  total: {
    type: Number,
    default: 0,
    min: 0
  }
});

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  balances: [balanceSchema],
  totalValueUSD: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Update total balance virtual
balanceSchema.virtual('total').get(function() {
  return this.available + this.locked;
});

// Pre-save middleware to update totals
walletSchema.pre('save', function(next) {
  this.balances.forEach(balance => {
    balance.total = balance.available + balance.locked;
  });
  next();
});

// Method to get balance for a currency
walletSchema.methods.getBalance = function(currency) {
  const balance = this.balances.find(b => b.currency === currency.toUpperCase());
  return balance || { available: 0, locked: 0, total: 0 };
};

// Method to update balance
walletSchema.methods.updateBalance = function(currency, availableDelta = 0, lockedDelta = 0) {
  const currencyUpper = currency.toUpperCase();
  let balance = this.balances.find(b => b.currency === currencyUpper);
  
  if (!balance) {
    balance = { currency: currencyUpper, available: 0, locked: 0 };
    this.balances.push(balance);
  }
  
  balance.available += availableDelta;
  balance.locked += lockedDelta;
  
  if (balance.available < 0 || balance.locked < 0) {
    throw new Error('Insufficient balance');
  }
  
  return this.save();
};

// Static method to get wallet by user ID
walletSchema.statics.getByUserId = function(userId) {
  return this.findOne({ userId }).populate('userId');
};

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;