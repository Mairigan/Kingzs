const WebSocket = require('ws');
const TradingEngine = require('./TradingEngine');

class WebSocketService {
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.clients = new Map();
    this.setupWebSocket();
  }

  setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      this.clients.set(clientId, { ws, subscriptions: new Set() });

      console.log(`Client ${clientId} connected`);

      ws.on('message', (message) => {
        this.handleMessage(clientId, message);
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`Client ${clientId} disconnected`);
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
        this.clients.delete(clientId);
      });

      // Send connection confirmation
      this.sendToClient(clientId, {
        type: 'connection_established',
        clientId,
        timestamp: Date.now()
      });
    });

    // Subscribe to trading engine events
    TradingEngine.on('trade_executed', (trade) => {
      this.broadcastToSubscribers(`trades:${trade.symbol}`, {
        type: 'trade',
        data: trade
      });
    });

    TradingEngine.on('orderbook_update', (data) => {
      this.broadcastToSubscribers(`orderbook:${data.symbol}`, {
        type: 'orderbook',
        data: data.orderBook
      });
    });
  }

  handleMessage(clientId, message) {
    try {
      const data = JSON.parse(message);
      
      switch (data.action) {
        case 'subscribe':
          this.handleSubscribe(clientId, data.channels);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, data.channels);
          break;
        case 'ping':
          this.sendToClient(clientId, { action: 'pong', timestamp: Date.now() });
          break;
        default:
          this.sendToClient(clientId, { 
            error: 'Unknown action', 
            action: data.action 
          });
      }
    } catch (error) {
      this.sendToClient(clientId, { 
        error: 'Invalid message format' 
      });
    }
  }

  handleSubscribe(clientId, channels) {
    const client = this.clients.get(clientId);
    if (!client) return;

    channels.forEach(channel => {
      client.subscriptions.add(channel);
    });

    this.sendToClient(clientId, {
      action: 'subscribed',
      channels: Array.from(client.subscriptions)
    });
  }

  handleUnsubscribe(clientId, channels) {
    const client = this.clients.get(clientId);
    if (!client) return;

    channels.forEach(channel => {
      client.subscriptions.delete(channel);
    });

    this.sendToClient(clientId, {
      action: 'unsubscribed',
      channels: Array.from(client.subscriptions)
    });
  }

  broadcastToSubscribers(channel, message) {
    this.clients.forEach((client, clientId) => {
      if (client.subscriptions.has(channel) {
        this.sendToClient(clientId, message);
      }
    });
  }

  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  generateClientId() {
    return Math.random().toString(36).substr(2, 9);
  }
}

module.exports = WebSocketService;