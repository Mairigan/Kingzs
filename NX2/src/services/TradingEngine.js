const EventEmitter = require('events');
const Order = require('../models/Order');
const Trade = require('../models/Trade');
const Wallet = require('../models/Wallet');

class TradingEngine extends EventEmitter {
  constructor() {
    super();
    this.orderBooks = new Map(); // symbol -> { bids: Map, asks: Map }
    this.pendingOrders = new Map();
    this.initializeOrderBooks();
  }

  initializeOrderBooks() {
    // Initialize order books for supported pairs
    const supportedPairs = [
      'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 
      'ADA/USDT', 'XRP/USDT', 'DOT/USDT', 'DOGE/USDT'
    ];

    supportedPairs.forEach(pair => {
      this.orderBooks.set(pair, {
        bids: new Map(), // price -> total quantity (sorted high to low)
        asks: new Map(), // price -> total quantity (sorted low to high)
        lastPrice: 0,
        volume24h: 0,
        high24h: 0,
        low24h: Infinity
      });
    });
  }

  async placeOrder(orderData) {
    try {
      // Validate order
      const validation = this.validateOrder(orderData);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Check balance for market orders
      if (orderData.type === 'market' && orderData.side === 'buy') {
        await this.checkBalance(orderData.userId, orderData.symbol, orderData.quantity, orderData.price);
      }

      // Create order record
      const order = await this.createOrderRecord(orderData);
      
      // Process order based on type
      let result;
      switch (order.type) {
        case 'limit':
          result = await this.processLimitOrder(order);
          break;
        case 'market':
          result = await this.processMarketOrder(order);
          break;
        default:
          throw new Error(`Unsupported order type: ${order.type}`);
      }

      this.emit('order_processed', { order, result });
      return result;

    } catch (error) {
      this.emit('order_error', { orderData, error });
      throw error;
    }
  }

  async processLimitOrder(order) {
    const orderBook = this.orderBooks.get(order.symbol);
    if (!orderBook) {
      throw new Error(`Unsupported trading pair: ${order.symbol}`);
    }

    const oppositeSide = order.side === 'buy' ? 'asks' : 'bids';
    let remainingQuantity = order.quantity;
    const trades = [];

    // Try to match with opposite side
    for (const [price, quantity] of orderBook[oppositeSide]) {
      if (remainingQuantity <= 0) break;

      // Check if order can be matched
      if ((order.side === 'buy' && price > order.price) ||
          (order.side === 'sell' && price < order.price)) {
        break;
      }

      const fillQuantity = Math.min(remainingQuantity, quantity);
      const trade = await this.executeTrade(order, price, fillQuantity, orderBook);
      trades.push(trade);

      remainingQuantity -= fillQuantity;

      // Update order book
      if (quantity === fillQuantity) {
        orderBook[oppositeSide].delete(price);
      } else {
        orderBook[oppositeSide].set(price, quantity - fillQuantity);
      }
    }

    // Add remaining to order book
    if (remainingQuantity > 0) {
      const sameSide = order.side === 'buy' ? 'bids' : 'asks';
      const currentQty = orderBook[sameSide].get(order.price) || 0;
      orderBook[sameSide].set(order.price, currentQty + remainingQuantity);
    }

    // Emit order book update
    this.emitOrderBookUpdate(order.symbol);

    return { order, trades, filled: order.quantity - remainingQuantity };
  }

  async processMarketOrder(order) {
    const orderBook = this.orderBooks.get(order.symbol);
    let remainingQuantity = order.quantity;
    const trades = [];
    let totalCost = 0;

    const oppositeSide = order.side === 'buy' ? 'asks' : 'bids';

    for (const [price, quantity] of orderBook[oppositeSide]) {
      if (remainingQuantity <= 0) break;

      const fillQuantity = Math.min(remainingQuantity, quantity);
      const trade = await this.executeTrade(order, price, fillQuantity, orderBook);
      trades.push(trade);

      remainingQuantity -= fillQuantity;
      totalCost += price * fillQuantity;

      // Update order book
      if (quantity === fillQuantity) {
        orderBook[oppositeSide].delete(price);
      } else {
        orderBook[oppositeSide].set(price, quantity - fillQuantity);
      }
    }

    // If not fully filled, update order status
    if (remainingQuantity > 0) {
      await Order.updateOne(
        { orderId: order.orderId },
        { 
          status: 'partially_filled',
          filledQuantity: order.quantity - remainingQuantity
        }
      );
    }

    this.emitOrderBookUpdate(order.symbol);
    return { order, trades, filled: order.quantity - remainingQuantity };
  }

  async executeTrade(order, price, quantity, orderBook) {
    // Create trade record
    const trade = new Trade({
      tradeId: this.generateTradeId(),
      symbol: order.symbol,
      price,
      quantity,
      side: order.side,
      takerOrderId: order.orderId,
      makerOrderId: 'maker_order_id', // Would be actual maker order ID
      takerUserId: order.userId,
      makerUserId: order.userId, // Simplified for MVP
      fee: {
        makerFee: quantity * price * 0.001, // 0.1% maker fee
        takerFee: quantity * price * 0.002, // 0.2% taker fee
        feeCurrency: 'USDT'
      }
    });

    await trade.save();

    // Update order
    await Order.updateOne(
      { orderId: order.orderId },
      { 
        $inc: { filledQuantity: quantity },
        averageFillPrice: (
          (order.averageFillPrice * (order.filledQuantity)) + 
          (price * quantity)
        ) / (order.filledQuantity + quantity)
      }
    );

    // Update user balances
    await this.updateBalances(order, trade);

    // Update market data
    this.updateMarketData(orderBook, price, quantity);

    this.emit('trade_executed', trade);
    return trade;
  }

  async updateBalances(order, trade) {
    const [baseCurrency, quoteCurrency] = order.symbol.split('/');
    
    if (order.side === 'buy') {
      // Buyer: spend quote currency, receive base currency
      await Wallet.updateOne(
        { userId: order.userId },
        { 
          $inc: {
            'balances.$[quote].available': -trade.quantity * trade.price,
            'balances.$[base].available': trade.quantity
          }
        },
        {
          arrayFilters: [
            { 'quote.currency': quoteCurrency },
            { 'base.currency': baseCurrency }
          ]
        }
      );
    } else {
      // Seller: spend base currency, receive quote currency
      await Wallet.updateOne(
        { userId: order.userId },
        { 
          $inc: {
            'balances.$[base].available': -trade.quantity,
            'balances.$[quote].available': trade.quantity * trade.price
          }
        },
        {
          arrayFilters: [
            { 'base.currency': baseCurrency },
            { 'quote.currency': quoteCurrency }
          ]
        }
      );
    }
  }

  validateOrder(orderData) {
    const required = ['userId', 'symbol', 'type', 'side', 'quantity'];
    const missing = required.filter(field => !orderData[field]);
    
    if (missing.length > 0) {
      return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
    }

    if (orderData.quantity <= 0) {
      return { valid: false, error: 'Quantity must be positive' };
    }

    if (orderData.type === 'limit' && (!orderData.price || orderData.price <= 0)) {
      return { valid: false, error: 'Limit orders require positive price' };
    }

    return { valid: true };
  }

  generateOrderId() {
    return `ORD${Date.now()}${Math.random().toString(36).substr(2, 9)}`.toUpperCase();
  }

  generateTradeId() {
    return `TRD${Date.now()}${Math.random().toString(36).substr(2, 9)}`.toUpperCase();
  }

  emitOrderBookUpdate(symbol) {
    const orderBook = this.orderBooks.get(symbol);
    this.emit('orderbook_update', { symbol, orderBook });
  }

  updateMarketData(orderBook, price, quantity) {
    orderBook.lastPrice = price;
    orderBook.volume24h += price * quantity;
    orderBook.high24h = Math.max(orderBook.high24h, price);
    orderBook.low24h = Math.min(orderBook.low24h, price);
  }

  async createOrderRecord(orderData) {
    const order = new Order({
      orderId: this.generateOrderId(),
      ...orderData
    });
    
    await order.save();
    return order;
  }
}

module.exports = new TradingEngine();