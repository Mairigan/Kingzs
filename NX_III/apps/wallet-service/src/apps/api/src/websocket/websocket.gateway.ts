import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

interface Client {
  socket: WebSocket;
  userId: string;
  subscriptions: Set<string>;
}

@WebSocketGateway(8080, { path: '/ws' })
export class WebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebSocketGateway.name);
  private clients: Map<string, Client> = new Map();

  constructor(private jwtService: JwtService) {}

  async handleConnection(socket: WebSocket, request: any) {
    try {
      const token = this.extractToken(request);
      if (!token) {
        socket.close(1008, 'Authentication required');
        return;
      }

      const payload = this.jwtService.verify(token);
      const clientId = this.generateClientId();

      this.clients.set(clientId, {
        socket,
        userId: payload.userId,
        subscriptions: new Set()
      });

      this.logger.log(`Client ${clientId} connected (User: ${payload.userId})`);

      // Send connection confirmation
      socket.send(JSON.stringify({
        type: 'connected',
        clientId,
        timestamp: Date.now()
      }));

    } catch (error) {
      this.logger.error('WebSocket connection failed:', error);
      socket.close(1008, 'Authentication failed');
    }
  }

  handleDisconnect(socket: WebSocket) {
    for (const [clientId, client] of this.clients.entries()) {
      if (client.socket === socket) {
        this.clients.delete(clientId);
        this.logger.log(`Client ${clientId} disconnected`);
        break;
      }
    }
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(socket: WebSocket, data: any) {
    const client = this.getClientBySocket(socket);
    if (!client) return;

    const { channels } = data;
    channels.forEach((channel: string) => {
      client.subscriptions.add(channel);
    });

    socket.send(JSON.stringify({
      type: 'subscribed',
      channels: Array.from(client.subscriptions)
    }));
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(socket: WebSocket, data: any) {
    const client = this.getClientBySocket(socket);
    if (!client) return;

    const { channels } = data;
    channels.forEach((channel: string) => {
      client.subscriptions.delete(channel);
    });

    socket.send(JSON.stringify({
      type: 'unsubscribed',
      channels: Array.from(client.subscriptions)
    }));
  }

  @SubscribeMessage('ping')
  handlePing(socket: WebSocket) {
    socket.send(JSON.stringify({
      type: 'pong',
      timestamp: Date.now()
    }));
  }

  // Broadcast methods for different data types
  broadcastOrderBookUpdate(symbol: string, orderBook: any) {
    this.broadcastToChannel(`orderbook:${symbol}`, {
      type: 'orderbook_update',
      symbol,
      data: orderBook
    });
  }

  broadcastTradeUpdate(trade: any) {
    this.broadcastToChannel(`trades:${trade.symbol}`, {
      type: 'trade',
      data: trade
    });
  }

  broadcastUserOrderUpdate(userId: string, order: any) {
    this.broadcastToUser(userId, {
      type: 'order_update',
      data: order
    });
  }

  broadcastBalanceUpdate(userId: string, balance: any) {
    this.broadcastToUser(userId, {
      type: 'balance_update',
      data: balance
    });
  }

  private broadcastToChannel(channel: string, message: any) {
    this.clients.forEach(client => {
      if (client.subscriptions.has(channel)) {
        this.sendToClient(client, message);
      }
    });
  }

  private broadcastToUser(userId: string, message: any) {
    this.clients.forEach(client => {
      if (client.userId === userId) {
        this.sendToClient(client, message);
      }
    });
  }

  private sendToClient(client: Client, message: any) {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  private extractToken(request: any): string | null {
    // Extract token from query string or headers
    return request.url.split('token=')[1] || null;
  }

  private generateClientId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  private getClientBySocket(socket: WebSocket): Client | undefined {
    for (const client of this.clients.values()) {
      if (client.socket === socket) {
        return client;
      }
    }
    return undefined;
  }
}