const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const dbSetup = require('./db-setup');
const db = require('../../src/services/manager-db');
const redis = require('../../src/services/redis');
jest.mock('../../src/services/redis'); // Mock redis for status tests

const internalRouter = require('../../src/routes/internal-v1');

let app;

beforeAll(async () => {
  await dbSetup.connect();
  
  process.env.KAIROS_INTERNAL_SERVICE_TOKEN = 'int-test-token';
  process.env.KAIROS_TENANT_SCOPE_SECRET = 'int-test-secret';
  
  app = express();
  app.use(express.json());
  app.use('/internal/v1', internalRouter);
});

afterAll(async () => {
  await dbSetup.closeDatabase();
});

beforeEach(async () => {
  await dbSetup.clearDatabase();
  jest.clearAllMocks();
});

const generateScopeToken = (tenantId) => {
  return jwt.sign({ tenant_id: tenantId }, process.env.KAIROS_TENANT_SCOPE_SECRET, { expiresIn: '60s' });
};

describe('GET /status', () => {
  const token = 'int-test-token';
  
  test('Retorna status saudável quando Redis está normal', async () => {
    redis.isBotOnStandby.mockResolvedValue(false);
    
    // Seed fake publish history
    const connection = await db.connect();
    await connection.collection('publish_history').insertOne({
      tenant_id: 'tenant123',
      version: 5,
      published_at: new Date()
    });
    
    const scopeToken = generateScopeToken('tenant123');
    const res = await request(app)
      .get('/internal/v1/tenants/tenant123/status')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', scopeToken);
      
    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(false);
    expect(res.body.evolution_session).toBe('connected');
    expect(res.body.last_published_version).toBe(5);
  });
  
  test('Retorna evolution_session paused se isBotOnStandby for true', async () => {
    redis.isBotOnStandby.mockResolvedValue(true);
    
    const scopeToken = generateScopeToken('tenant123');
    const res = await request(app)
      .get('/internal/v1/tenants/tenant123/status')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', scopeToken);
      
    expect(res.status).toBe(200);
    expect(res.body.evolution_session).toBe('paused');
  });
  
  test('Retorna degraded true se Redis falhar', async () => {
    redis.isBotOnStandby.mockRejectedValue(new Error('Redis connection lost'));
    
    const scopeToken = generateScopeToken('tenant123');
    const res = await request(app)
      .get('/internal/v1/tenants/tenant123/status')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', scopeToken);
      
    expect(res.status).toBe(200); // O endpoint NUNCA derruba o monitor, sempre retorna 200
    expect(res.body.degraded).toBe(true);
    expect(res.body.evolution_session).toBe('unknown');
    expect(res.body.degraded_reason).toMatch(/Redis/);
  });
});
