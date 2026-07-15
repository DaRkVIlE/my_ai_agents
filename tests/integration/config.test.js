const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const dbSetup = require('./db-setup');
const db = require('../../src/services/manager-db');
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
  
  // Seed the test database with a mock profile for tenant123
  const connection = await db.connect();
  await connection.collection('manager_profiles').insertOne({
    manager_id: 'tenant123',
    test: true,
    config: { channels: ['whatsapp'] }
  });
});

const generateScopeToken = (tenantId) => {
  return jwt.sign({ tenant_id: tenantId }, process.env.KAIROS_TENANT_SCOPE_SECRET, { expiresIn: '60s' });
};

describe('GET /config', () => {
  const token = 'int-test-token';
  
  test('Retorna config default quando tenant não tem bot_configurations', async () => {
    const scopeToken = generateScopeToken('tenant123');
    
    const res = await request(app)
      .get('/internal/v1/tenants/tenant123/config')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', scopeToken);
      
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.profile).toBeDefined();
    expect(res.body.bot_config).toBeNull();
  });
  
  test('Retorna 404 quando tenant_id não existe', async () => {
    const scopeToken = generateScopeToken('nao-existe');
    
    const res = await request(app)
      .get('/internal/v1/tenants/nao-existe/config')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', scopeToken);
      
    expect(res.status).toBe(404);
  });
});

describe('PUT /config', () => {
  const token = 'int-test-token';
  
  test('Cria config draft com versão 2 quando a esperada é 1', async () => {
    // Primeiro, cria a versão 1
    const connection = await db.connect();
    await connection.collection('bot_configurations').insertOne({
      manager_id: 'tenant123',
      version: 1,
      config: { active: true },
      status: 'active'
    });
    
    const scopeToken = generateScopeToken('tenant123');
    
    const res = await request(app)
      .put('/internal/v1/tenants/tenant123/config')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', scopeToken)
      .send({
        expected_version: 1,
        bot_config: { active: false }
      });
      
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.status).toBe('draft');
  });
  
  test('Retorna 409 quando expected_version não bate com a do DB', async () => {
    const connection = await db.connect();
    await connection.collection('bot_configurations').insertOne({
      manager_id: 'tenant123',
      version: 5,
      config: { active: true },
      status: 'active'
    });
    
    const scopeToken = generateScopeToken('tenant123');
    
    const res = await request(app)
      .put('/internal/v1/tenants/tenant123/config')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', scopeToken)
      .send({
        expected_version: 3, // Outdated
        bot_config: { active: false }
      });
      
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/CONFLICT/);
    expect(res.body.current_version).toBeDefined();
  });
});
