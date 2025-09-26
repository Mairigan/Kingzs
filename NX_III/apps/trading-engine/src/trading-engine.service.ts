import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderType, OrderSide, OrderStatus } from '@nx-exchange/database';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'ws';
import { RedisService } from '@nestjs/redis';

interface OrderBook {
  bids: Map<number, number>; // price -> quantity
  asks: Map<number, number>;
  lastPrice: number;
  volume24h: number;
}

interface DarkPoolOrder extends Order {
  minimumSize: number;
  visibleSize: number;
  participants: string[];
}

@WebSocketGateway(8080, { path: '/ws' })
@Injectable()
export class TradingEngineService {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TradingEngineService.name);
  private orderBooks: Map<string, OrderBook> = new Map();
  private darkPoolOrders: Map<string, DarkPoolOrder> = new Map();

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private redisService: RedisService
  ) {
    this.initializeOrderBooks();
    this.startMarketDataFeeds();
  }

  private initializeOrderBooks() {
    const pairs = [
      'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'ADA/USDT',
      'XRP/USDT', 'DOT/USDT', 'DOGE/USDT', 'SHIB/USDT', 'MATIC/USDT'
    ];

    pairs.forEach(pair => {
      this.orderBooks.set(pair, {
        bids: new Map(),
        asks: new Map(),
        lastPrice: 0,
        volume24h: 0
      });
    });
  }

  async placeOrder(orderData: Partial<Order>): Promise<Order> {
    // Validate order
    const validation = this.validateOrder(orderData);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Check balance
    await this.checkBalance(orderData.userId, orderData.symbol, orderData.side, orderData.quantity, orderData.price);

    // Create order
    const order = new this.orderModel({
      orderId: this.generateOrderId(),
      ...orderData,
      status: OrderStatus.OPEN
    });

    await order.save();

    // Process based on type
    let result;
    switch (order.type) {
      case OrderType.LIMIT:
        result = await this.processLimitOrder(order);
        break;
      case OrderType.MARKET:
        result = await this.processMarketOrder(order);
        break;
      case OrderType.CONDITIONAL:
        result = await this.processConditionalOrder(order);
        break;
      case OrderType.SMART:
        result = await this.processSmartOrder(order);
        break;
      default:
        throw new Error(`Unsupported order type: ${order.type}`);
    }

    // Broadcast updates
    this.broadcastOrderUpdate(order);
    this.broadcastMarketData(order.symbol);

    return order;
  }

  private async processLimitOrder(order: OrderDocument) {
    const orderBook = this.orderBooks.get(order.symbol);
    const oppositeSide = order.side === OrderSide.BUY ? 'asks' : 'bids';

    let remainingQuantity = order.quantity;
    const trades = [];

    // Match with opposite side
    for (const [price, quantity] of orderBook[oppositeSide].entries()) {
      if (remainingQuantity <= 0) break;

      if ((order.side === OrderSide.BUY && price > order.price) ||
          (order.side === OrderSide.SELL && price < order.price)) {
        break;
      }

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
      const sameSide = order.side === OrderSide.BUY ? 'bids' : 'asks';
      const currentQty = orderBook[sameSide].get(order.price) || 0;
      orderBook[sameSide].set(order.price, currentQty + remainingQuantity);
    }

    return { trades, filled: order.quantity - remainingQuantity };
  }

  private async processMarketOrder(order: OrderDocument) {
    const orderBook = this.orderBooks.get(order.symbol);
    const oppositeSide = order.side === OrderSide.BUY ? 'asks' : 'bids';

    let remainingQuantity = order.quantity;
    const trades = [];
    let totalCost = 0;

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

    return { trades, filled: order.quantity - remainingQuantity, averagePrice: totalCost / (order.quantity - remainingQuantity) };
  }

  private async processConditionalOrder(order: OrderDocument) {
    // Store conditional order and wait for condition to trigger
    await this.redisService.set(
      `conditional_order:${order.orderId}`,
      JSON.stringify(order),
      'EX',
      24 * 60 * 60 // 24 hours
    );

    this.logger.log(`Conditional order ${order.orderId} waiting for trigger`);
    return { trades: [], filled: 0 };
  }

  private async processSmartOrder(order: OrderDocument) {
    // Smart order routing across different venues
    const venues = await this.getAvailableVenues(order.symbol);
    const allocations = this.calculateSmartAllocation(order, venues);

    const results = [];
    for (const allocation of allocations) {
      try {
        const result = await this.routeToVenue(order, allocation);
        results.push(result);
      } catch (error) {
        this.logger.error(`Smart routing failed for venue ${allocation.venue}:`, error);
      }
    }

    return this.aggregateSmartResults(results);
  }

  // Dark Pool functionality
  async placeDarkPoolOrder(orderData: Partial<Order>): Promise<Order> {
    if (orderData.quantity < parseFloat(process.env.DARK_POOL_MIN_ORDER)) {
      throw new Error(`Dark pool orders require minimum size of ${process.env.DARK_POOL_MIN_ORDER}`);
    }

    const darkOrder: DarkPoolOrder = {
      ...orderData,
      minimumSize: parseFloat(process.env.DARK_POOL_MIN_ORDER),
      visibleSize: orderData.quantity * 0.1, // Show only 10%
      participants: [], // Eligible participants
      isDarkPool: true
    } as DarkPoolOrder;

    this.darkPoolOrders.set(darkOrder.orderId, darkOrder);
    
    // Match within dark pool
    await this.matchDarkPoolOrders(darkOrder.symbol);

    return darkOrder as Order;
  }

  private async matchDarkPoolOrders(symbol: string) {
    const darkOrders = Array.from(this.darkPoolOrders.values())
      .filter(order => order.symbol === symbol && order.status === OrderStatus.OPEN);

    // Simple dark pool matching logic
    for (const buyOrder of darkOrders.filter(o => o.side === OrderSide.BUY)) {
      for (const sellOrder of darkOrders.filter(o => o.side === OrderSide.SELL)) {
        if (buyOrder.price >= sellOrder.price) {
          const fillQuantity = Math.min(buyOrder.remainingQuantity, sellOrder.remainingQuantity);
          await this.executeDarkPoolTrade(buyOrder, sellOrder, fillQuantity);
        }
      }
    }
  }

  private async executeDarkPoolTrade(buyOrder: DarkPoolOrder, sellOrder: DarkPoolOrder, quantity: number) {
    const price = (buyOrder.price + sellOrder.price) / 2; // Mid-price execution
    
    // Update orders
    buyOrder.filledQuantity += quantity;
    sellOrder.filledQuantity += quantity;

    if (buyOrder.filledQuantity >= buyOrder.quantity) {
      buyOrder.status = OrderStatus.FILLED;
      this.darkPoolOrders.delete(buyOrder.orderId);
    }

    if (sellOrder.filledQuantity >= sellOrder.quantity) {
      sellOrder.status = OrderStatus.FILLED;
      this.darkPoolOrders.delete(sellOrder.orderId);
    }

    // Broadcast dark pool fill (anonymized)
    this.broadcastDarkPoolFill(symbol, quantity, price);
  }

  // WebSocket broadcasting
  private broadcastOrderUpdate(order: Order) {
    this.server.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'order_update',
          data: order
        }));
      }
    });
  }

  private broadcastMarketData(symbol: string) {
    const orderBook = this.orderBooks.get(symbol);
    this.server.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'market_data',
          symbol,
          data: orderBook
        }));
      }
    });
  }

  private broadcastDarkPoolFill(symbol: string, quantity: number, price: number) {
    this.server.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'dark_pool_fill',
          symbol,
          quantity,
          price,
          timestamp: Date.now()
        }));
      }
    });
  }

  private generateOrderId(): string {
    return `NX${Date.now()}${Math.random().toString(36).substr(2, 9)}`.toUpperCase();
  }

  private validateOrder(order: Partial<Order>): { valid: boolean; error?: string } {
    // Comprehensive order validation
    if (order.quantity <= 0) {
      return { valid: false, error: 'Quantity must be positive' };
    }

    if (order.type === OrderType.LIMIT && (!order.price || order.price <= 0)) {
      return { valid: false, error: 'Limit orders require positive price' };
    }

    if (order.leverage < 1 || order.leverage > 100) {
      return { valid: false, error: 'Leverage must be between 1 and 100' };
    }

    return { valid: true };
  }

  private async checkBalance(userId: string, symbol: string, side: OrderSide, quantity: number, price: number) {
    // Balance check implementation
    // This would interface with the wallet service
  }

  private async executeTrade(order: OrderDocument, price: number, quantity: number) {
    // Trade execution logic
    // Update balances, create trade record, etc.
  }

  private startMarketDataFeeds() {
    // Connect to external market data providers
    setInterval(() => this.updateMarketPrices(), 1000); // Update every second
  }

  private async updateMarketPrices() {
    // Fetch latest prices from multiple exchanges
    for (const [symbol, orderBook] of this.orderBooks.entries()) {
      try {
        const price = await this.fetchMarketPrice(symbol);
        orderBook.lastPrice = price;
      } catch (error) {
        this.logger.error(`Failed to update price for ${symbol}:`, error);
      }
    }
  }

  private async fetchMarketPrice(symbol: string): Promise<number> {
    // Implementation to fetch from Binance, etc.
    return 0; // Placeholder
  }
}