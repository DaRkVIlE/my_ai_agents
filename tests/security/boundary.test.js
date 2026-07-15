const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const dbSetup = require('../integration/db-setup');
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

const generateScopeToken = (tenantId) => {
  return jwt.sign({ tenant_id: tenantId }, process.env.KAIROS_TENANT_SCOPE_SECRET, { expiresIn: '60s' });
};

describe('Security Boundary Tests - Isolamento de Tenant', () => {
  const token = 'int-test-token';
  const wrongScopeToken = generateScopeToken('outro-tenant-malicioso');
  const targetTenant = 'tenant-alvo-123';
  
  test('GET /config com escopo errado -> 403', async () => {
    const res = await request(app)
      .get(`/internal/v1/tenants/${targetTenant}/config`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', wrongScopeToken);
      
    expect(res.status).toBe(403);
  });
  
  test('PUT /config com escopo errado -> 403', async () => {
    const res = await request(app)
      .put(`/internal/v1/tenants/${targetTenant}/config`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', wrongScopeToken)
      .send({ expected_version: 1, bot_config: {} });
      
    expect(res.status).toBe(403);
  });
  
  test('POST /publish com escopo errado -> 403', async () => {
    const res = await request(app)
      .post(`/internal/v1/tenants/${targetTenant}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', wrongScopeToken)
      .send({ version: 2 });
      
    expect(res.status).toBe(403);
  });
  
  test('GET /status com escopo errado -> 403', async () => {
    const res = await request(app)
      .get(`/internal/v1/tenants/${targetTenant}/status`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Scope', wrongScopeToken);
      
    expect(res.status).toBe(403);
  });
});
