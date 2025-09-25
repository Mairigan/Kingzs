class CopyTradingEngine {
  constructor() {
    this.traders = new Map(); // Master traders
    this.followers = new Map(); // Followers and their subscriptions
    this.performanceMetrics = new Map();
  }

  async registerAsTrader(userId, traderConfig) {
    const {
      minCopyAmount,
      maxCopyAmount,
      performanceFee, // Percentage of profits
      maxFollowers,
      tradingStrategy,
      riskLevel
    } = traderConfig;

    const trader = {
      userId,
      minCopyAmount,
      maxCopyAmount,
      performanceFee,
      maxFollowers,
      tradingStrategy,
      riskLevel,
      status: 'active',
      followersCount: 0,
      totalCopied: 0,
      performance: {
        totalReturn: 0,
        monthlyReturn: 0,
        winRate: 0,
        totalTrades: 0,
        sharpeRatio: 0
      },
      createdAt: Date.now()
    };

    this.traders.set(userId, trader);
    await this.saveTrader(trader);

    // Start tracking trader's performance
    this.startPerformanceTracking(userId);

    return trader;
  }

  async followTrader(followerId, traderId, copySettings) {
    const {
      copyAmount,
      riskMultiplier = 1.0,
      maxDrawdown, // Automatic stop loss
      takeProfit,
      stopLoss
    } = copySettings;

    const trader = this.traders.get(traderId);
    if (!trader || trader.status !== 'active') {
      throw new Error('Trader not available for copying');
    }

    if (trader.followersCount >= trader.maxFollowers) {
      throw new Error('Trader has reached maximum followers');
    }

    if (copyAmount < trader.minCopyAmount || copyAmount > trader.maxCopyAmount) {
      throw new Error('Copy amount outside trader limits');
    }

    const subscription = {
      subscriptionId: this.generateSubscriptionId(),
      followerId,
      traderId,
      copyAmount,
      riskMultiplier,
      maxDrawdown,
      takeProfit,
      stopLoss,
      status: 'active',
      copiedAmount: 0,
      currentPnL: 0,
      startedAt: Date.now()
    };

    // Store subscription
    this.followers.set(subscription.subscriptionId, subscription);
    trader.followersCount += 1;

    // Setup trade copying
    this.setupTradeCopying(subscription);

    return subscription;
  }

  setupTradeCopying(subscription) {
    const { traderId, followerId, copyAmount, riskMultiplier } = subscription;

    // Listen to trader's trades
    this.tradingEngine.on(`trade_executed:${traderId}`, async (trade) => {
      if (subscription.status !== 'active') return;

      // Calculate copy trade size
      const copyTradeSize = await this.calculateCopyTradeSize(
        subscription,
        trade
      );

      if (copyTradeSize > 0) {
        await this.executeCopyTrade(subscription, trade, copyTradeSize);
      }
    });
  }

  async calculateCopyTradeSize(subscription, originalTrade) {
    const { copyAmount, riskMultiplier } = subscription;
    const trader = this.traders.get(subscription.traderId);

    // Get trader's account size for proportion calculation
    const traderBalance = await this.getTraderBalance(subscription.traderId);
    const proportion = copyAmount / traderBalance;

    // Apply risk multiplier
    const adjustedProportion = proportion * riskMultiplier;

    return originalTrade.quantity * adjustedProportion;
  }

  async executeCopyTrade(subscription, originalTrade, copyQuantity) {
    const copyTrade = {
      followerId: subscription.followerId,
      symbol: originalTrade.symbol,
      type: originalTrade.type,
      side: originalTrade.side,
      quantity: copyQuantity,
      source: 'copy_trading',
      originalTradeId: originalTrade.tradeId,
      subscriptionId: subscription.subscriptionId
    };

    try {
      const result = await this.tradingEngine.placeOrder(copyTrade);
      
      // Record copy trade
      await this.recordCopyTrade(subscription.subscriptionId, originalTrade, copyTrade, result);

      // Update subscription stats
      subscription.copiedAmount += copyQuantity * originalTrade.price;
      await this.updateSubscription(subscription);

      console.log(`Copied trade for follower ${subscription.followerId}`);
    } catch (error) {
      console.error('Copy trade execution failed:', error);
      // Implement error handling and retry logic
    }
  }

  async getTopTraders(filters = {}) {
    const {
      minWinRate = 0,
      minTotalReturn = 0,
      maxDrawdown = 100,
      strategy,
      riskLevel
    } = filters;

    const traders = Array.from(this.traders.values())
      .filter(trader => 
        trader.performance.winRate >= minWinRate &&
        trader.performance.totalReturn >= minTotalReturn &&
        trader.performance.maxDrawdown <= maxDrawdown &&
        (!strategy || trader.tradingStrategy === strategy) &&
        (!riskLevel || trader.riskLevel === riskLevel)
      )
      .sort((a, b) => b.performance.totalReturn - a.performance.totalReturn);

    return traders.slice(0, 100); // Top 100 traders
  }

  // Risk management for copy trading
  async checkRiskLimits(subscription, proposedTrade) {
    const { maxDrawdown, stopLoss, takeProfit } = subscription;

    // Check current PnL against limits
    if (subscription.currentPnL <= -maxDrawdown) {
      await this.stopCopyTrading(subscription.subscriptionId, 'max_drawdown_reached');
      return false;
    }

    // Check stop loss and take profit
    if (stopLoss && subscription.currentPnL <= -stopLoss) {
      await this.stopCopyTrading(subscription.subscriptionId, 'stop_loss_triggered');
      return false;
    }

    if (takeProfit && subscription.currentPnL >= takeProfit) {
      await this.stopCopyTrading(subscription.subscriptionId, 'take_profit_triggered');
      return false;
    }

    return true;
  }
}
