const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock dependencies
jest.mock('../../src/services/manager-db');

const internalRouter = require('../../src/routes/internal-v1');

describe('Validação de Payload (422s) - Unit Tests', () => {
  let app;
  
  beforeEach(() => {
    process.env.KAIROS_INTERNAL_SERVICE_TOKEN = 'test-service-token';
    process.env.KAIROS_TENANT_SCOPE_SECRET = 'test-scope-secret';
    
    app = express();
    app.use(express.json());
    app.use('/internal/v1', internalRouter);
  });

  const validServiceToken = 'test-service-token';
  const targetTenant = 'tenant123';
  
  const generateScopeToken = () => {
    return jwt.sign({ tenant_id: targetTenant }, process.env.KAIROS_TENANT_SCOPE_SECRET, { expiresIn: '60s' });
  };

  test('PUT /config sem expected_version no body -> 422', async () => {
    const validScopeToken = generateScopeToken();
    const res = await request(app)
      .put(`/internal/v1/tenants/${targetTenant}/config`)
      .set('Authorization', `Bearer ${validServiceToken}`)
      .set('X-Tenant-Scope', validScopeToken)
      .send({ profile: {}, bot_config: {} }); // faltou expected_version
      
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Missing expected_version');
  });

  test('POST /publish sem version no body -> 422', async () => {
    const validScopeToken = generateScopeToken();
    const res = await request(app)
      .post(`/internal/v1/tenants/${targetTenant}/publish`)
      .set('Authorization', `Bearer ${validServiceToken}`)
      .set('X-Tenant-Scope', validScopeToken)
      .send({}); // faltou version
      
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Missing version');
  });
});
