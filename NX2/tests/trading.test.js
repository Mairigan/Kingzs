const request = require('supertest');
const Application = require('../src/app');
const User = require('../src/models/User');
const Order = require('../src/models/Order');

describe('Trading API', () => {
  let app;
  let server;
  let authToken;
  let userId;

  beforeAll(async () => {
    app = new Application();
    server = await app.start(3001);
    
    // Create test user
    const user = new User({
      email: 'test@trader.com',
      password: 'password123',
      name: 'Test Trader'
    });
    await user.save();
    userId = user._id;
    
    // Get auth token
    const response = await request(server)
      .post('/api/auth/login')
      .send({
        email: 'test@trader.com',
        password: 'password123'
      });
    
    authToken = response.body.token;
  });

  afterAll(async () => {
    await User.deleteMany({});
    await Order.deleteMany({});
    await app.stop();
  });

  describe('POST /api/trading/order', () => {
    it('should place a limit buy order', async () => {
      const response = await request(server)
        .post('/api/trading/order')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          symbol: 'BTC/USDT',
          type: 'limit',
          side: 'buy',
          quantity: 0.1,
          price: 50000
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.orderId).toBeDefined();
    });

    it('should reject invalid order data', async () => {
      const response = await request(server)
        .post('/api/trading/order')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          symbol: 'INVALID',
          type: 'limit',
          side: 'buy',
          quantity: -1 // Invalid quantity
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/trading/orders', () => {
    it('should retrieve user orders', async () => {
      const response = await request(server)
        .get('/api/trading/orders')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.orders)).toBe(true);
    });
  });
});