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
});

const generateScopeToken = (tenantId) => {
  return jwt.sign({ tenant_id: tenantId }, process.env.KAIROS_TENANT_SCOPE_SECRET, { expiresIn: '60s' });
};

describe('POST /publish', () => {
  const token = 'int-test-token';
  
  test('Publica a versão quando ela existe em draft (bot_configurations)', async () => {
    const connection = await db.connect();
    // Inserir um profile fake
    await connection.collection('manager_profiles').insertOne({ manager_id: 'tenant123', test: true });
    // Inserir config em draft
    await connection.collection('bot_configurations').insertOne({
      manager_id: 'tenant123',
      version: 2,
      config: { active: true },
      status: 'draft'
    });
    
    const scopeToken = generateScopeToken('tenant123');
    const res = await request(app)
      .post('/internal/v1/tenants/tenant123/publish')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', scopeToken)
      .send({ version: 2 });
      
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
    expect(res.body.status).toBe('live');
    
    // Verifica se gravou no publish_history
    const history = await connection.collection('publish_history').findOne({ tenant_id: 'tenant123', version: 2 });
    expect(history).toBeDefined();
    
    // Verifica se bot_configurations atualizou o status para active
    const botConfig = await connection.collection('bot_configurations').findOne({ manager_id: 'tenant123', version: 2 });
    expect(botConfig.status).toBe('active');
  });
  
  test('Retorna 409 quando versão não é encontrada', async () => {
    const scopeToken = generateScopeToken('tenant123');
    const res = await request(app)
      .post('/internal/v1/tenants/tenant123/publish')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', scopeToken)
      .send({ version: 99 });
      
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Draft not found for this version');
  });
});
