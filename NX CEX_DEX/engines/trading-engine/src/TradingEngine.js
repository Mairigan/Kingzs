const EventEmitter = require('events');
const Redis = require('ioredis');
const WebSocket = require('ws');

class TradingEngine extends EventEmitter {
  constructor() {
    super();
    this.redis = new Redis.Cluster([
      { host: 'redis-node-1', port: 6379 },
      { host: 'redis-node-2', port: 6379 },
      { host: 'redis-node-3', port: 6379 }
    ]);
    
    this.orderBooks = new Map();
    this.positions = new Map();
    this.marketData = new Map();
    
    this.initializeMarkets();
    this.connectToPriceFeeds();
  }

  initializeMarkets() {
    // Spot markets (1000+ pairs)
    const spotPairs = this.generateTradingPairs([
      'BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL', 'XRP', 'ADA',
      'AVAX', 'DOT', 'MATIC', 'LINK', 'ATOM', 'UNI', 'LTC', 'BCH',
      // Memecoins
      'DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK', 'WIF', 'BOME', 'MEME'
    ], 'USDT', 'USD', 'BUSD');

    // Futures markets
    const futuresPairs = spotPairs.map(pair => `${pair}_QUARTER`);
    
    // Perpetual markets
    const perpetualPairs = spotPairs.map(pair => `${pair}_PERP`);

    // Stock tokens (tokenized stocks)
    const stockPairs = [
      'TSLA/USD', 'AAPL/USD', 'GOOGL/USD', 'AMZN/USD', 'META/USD',
      'NFLX/USD', 'NVDA/USD', 'MSFT/USD', 'SPY/USD', 'QQQ/USD'
    ];

    // Initialize all markets
    [...spotPairs, ...futuresPairs, ...perpetualPairs, ...stockPairs].forEach(pair => {
      this.orderBooks.set(pair, {
        bids: new Map(), // price -> total quantity
        asks: new Map(),
        lastPrice: 0,
        volume24h: 0,
        fundingRate: 0, // for perpetuals
        openInterest: 0,
        markPrice: 0
      });
    });
  }

  generateTradingPairs(baseCurrencies, ...quoteCurrencies) {
    const pairs = [];
    baseCurrencies.forEach(base => {
      quoteCurrencies.forEach(quote => {
        if (base !== quote) {
          pairs.push(`${base}/${quote}`);
        }
      });
    });
    return pairs;
  }

  async placeOrder(orderData) {
    const {
      userId,
      symbol,
      type, // limit, market, stop_limit, stop_market
      side, // buy, sell
      quantity,
      price,
      stopPrice,
      timeInForce, // GTC, IOC, FOK
      leverage = 1, // for margin trading
      reduceOnly = false
    } = orderData;

    // Validate order
    const validation = await this.validateOrder(orderData);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Generate order ID
    const orderId = this.generateOrderId(symbol, side);

    const order = {
      orderId,
      userId,
      symbol,
      type,
      side,
      quantity: parseFloat(quantity),
      price: type === 'market' ? null : parseFloat(price),
      stopPrice: stopPrice ? parseFloat(stopPrice) : null,
      timeInForce,
      leverage,
      reduceOnly,
      status: 'open',
      filledQuantity: 0,
      avgFillPrice: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // Store order
    await this.storeOrder(order);

    // Process based on order type
    switch (type) {
      case 'limit':
        await this.processLimitOrder(order);
        break;
      case 'market':
        await this.processMarketOrder(order);
        break;
      case 'stop_limit':
      case 'stop_market':
        await this.processStopOrder(order);
        break;
    }

    return orderId;
  }

  async processLimitOrder(order) {
    const orderBook = this.orderBooks.get(order.symbol);
    const oppositeSide = order.side === 'buy' ? 'asks' : 'bids';

    let remainingQuantity = order.quantity;
    const trades = [];

    // Match with opposite side
    for (const [price, quantity] of orderBook[oppositeSide].entries()) {
      if (remainingQuantity <= 0) break;

      // Check price conditions
      if (order.side === 'buy' && price > order.price) break;
      if (order.side === 'sell' && price < order.price) break;

      const fillQuantity = Math.min(remainingQuantity, quantity);
      const trade = await this.executeTrade(order, price, fillQuantity);
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

    // Emit real-time updates
    this.emitOrderBookUpdate(order.symbol);
    trades.forEach(trade => this.emitTrade(trade));
  }

  async processMarketOrder(order) {
    const orderBook = this.orderBooks.get(order.symbol);
    const oppositeSide = order.side === 'buy' ? 'asks' : 'bids';

    let remainingQuantity = order.quantity;
    let totalCost = 0;
    const trades = [];

    // Execute at best available prices
    for (const [price, quantity] of orderBook[oppositeSide].entries()) {
      if (remainingQuantity <= 0) break;

      const fillQuantity = Math.min(remainingQuantity, quantity);
      const trade = await this.executeTrade(order, price, fillQuantity);
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

    // Handle partial fills
    if (remainingQuantity > 0) {
      order.status = 'partially_filled';
      order.filledQuantity = order.quantity - remainingQuantity;
      await this.updateOrder(order);

      // Cancel remaining for market orders
      if (order.type === 'market') {
        order.status = 'filled';
        await this.updateOrder(order);
      }
    }

    this.emitOrderBookUpdate(order.symbol);
    trades.forEach(trade => this.emitTrade(trade));
  }

  async executeTrade(order, price, quantity) {
    const trade = {
      tradeId: this.generateTradeId(),
      symbol: order.symbol,
      price,
      quantity,
      side: order.side,
      takerOrderId: order.orderId,
      makerOrderId: 'counterparty', // Would be actual maker order ID
      timestamp: Date.now(),
      fee: this.calculateFee(quantity * price)
    };

    // Update order
    order.filledQuantity += quantity;
    order.avgFillPrice = ((order.avgFillPrice * (order.filledQuantity - quantity)) + (price * quantity)) / order.filledQuantity;

    if (order.filledQuantity >= order.quantity) {
      order.status = 'filled';
    }

    await this.updateOrder(order);

    // Update user positions (for margin trading)
    await this.updateUserPosition(order.userId, order.symbol, order.side, quantity, price, order.leverage);

    // Store trade
    await this.redis.hset(
      `trades:${order.symbol}`,
      trade.tradeId,
      JSON.stringify(trade)
    );

    // Update market data
    await this.updateMarketData(order.symbol, price, quantity);

    return trade;
  }

  async updateUserPosition(userId, symbol, side, quantity, price, leverage) {
    const positionKey = `position:${userId}:${symbol}`;
    const existingPosition = await this.redis.get(positionKey);

    let position = existingPosition ? JSON.parse(existingPosition) : {
      symbol,
      side,
      quantity: 0,
      entryPrice: 0,
      leverage,
      liquidationPrice: 0,
      pnl: 0,
      margin: 0
    };

    if (position.side === side) {
      // Increase position
      position.quantity += quantity;
      position.entryPrice = ((position.entryPrice * (position.quantity - quantity)) + (price * quantity)) / position.quantity;
    } else {
      // Decrease or reverse position
      if (quantity <= position.quantity) {
        position.quantity -= quantity;
        // Calculate PnL for closed portion
        const pnl = (price - position.entryPrice) * quantity * (position.side === 'long' ? 1 : -1);
        position.pnl += pnl;
      } else {
        // Position reversal
        const closedPnl = (price - position.entryPrice) * position.quantity * (position.side === 'long' ? 1 : -1);
        position.side = side;
        position.quantity = quantity - position.quantity;
        position.entryPrice = price;
        position.pnl += closedPnl;
      }
    }

    // Update liquidation price
    position.liquidationPrice = this.calculateLiquidationPrice(position);
    
    // Update margin
    position.margin = (position.quantity * position.entryPrice) / leverage;

    await this.redis.set(positionKey, JSON.stringify(position));
    this.emitPositionUpdate(userId, symbol, position);
  }

  calculateLiquidationPrice(position) {
    const marginRatio = 0.05; // 5% maintenance margin
    if (position.side === 'long') {
      return position.entryPrice * (1 - (1 / position.leverage) + marginRatio);
    } else {
      return position.entryPrice * (1 + (1 / position.leverage) - marginRatio);
    }
  }

  // Real-time market data broadcasting
  setupWebSocketServer(server) {
    const wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws, request) => {
      const connectionId = this.generateConnectionId();
      this.connections.set(connectionId, ws);

      ws.on('message', (message) => {
        this.handleWebSocketMessage(connectionId, message);
      });

      ws.on('close', () => {
        this.connections.delete(connectionId);
      });

      // Send initial data
      this.sendInitialData(ws);
    });

    // Broadcast market data updates
    this.on('orderbook_update', (data) => {
      this.broadcastToSubscribers(`orderbook_${data.symbol}`, {
        type: 'orderbook_update',
        data
      });
    });

    this.on('trade', (trade) => {
      this.broadcastToSubscribers(`trades_${trade.symbol}`, {
        type: 'trade',
        data: trade
      });
    });
  }

  broadcastToSubscribers(channel, message) {
    this.connections.forEach((ws, connectionId) => {
      if (ws.readyState === WebSocket.OPEN && this.subscriptions[connectionId]?.includes(channel)) {
        ws.send(JSON.stringify(message));
      }
    });
  }
}

module.exports = TradingEngine;
