const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock dependencies
const db = require('../../src/services/manager-db');
jest.mock('../../src/services/manager-db');

const internalRouter = require('../../src/routes/internal-v1');

describe('Conflito de Versão (Optimistic Concurrency) - Unit Tests', () => {
  let app;
  
  beforeEach(() => {
    process.env.KAIROS_INTERNAL_SERVICE_TOKEN = 'test-service-token';
    process.env.KAIROS_TENANT_SCOPE_SECRET = 'test-scope-secret';
    
    app = express();
    app.use(express.json());
    app.use('/internal/v1', internalRouter);
    jest.clearAllMocks();
  });

  const validServiceToken = 'test-service-token';
  const targetTenant = 'tenant123';
  
  const generateScopeToken = () => {
    return jwt.sign({ tenant_id: targetTenant }, process.env.KAIROS_TENANT_SCOPE_SECRET, { expiresIn: '60s' });
  };

  test('PUT /config retorna 409 quando há conflito de versão', async () => {
    // Simula erro de conflito lançado pelo banco
    db.saveInternalConfigDraft.mockRejectedValue(new Error('CONFLICT: expected 1 but got 2'));
    
    const validScopeToken = generateScopeToken();
    const res = await request(app)
      .put(`/internal/v1/tenants/${targetTenant}/config`)
      .set('Authorization', `Bearer ${validServiceToken}`)
      .set('X-Tenant-Scope', validScopeToken)
      .send({ expected_version: 1, bot_config: {} });
      
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/CONFLICT: expected 1 but got 2/);
  });

  test('POST /publish retorna 409 quando draft não é encontrado para a versão', async () => {
    db.publishInternalConfig.mockRejectedValue(new Error('Draft not found for this version'));
    
    const validScopeToken = generateScopeToken();
    const res = await request(app)
      .post(`/internal/v1/tenants/${targetTenant}/publish`)
      .set('Authorization', `Bearer ${validServiceToken}`)
      .set('X-Tenant-Scope', validScopeToken)
      .send({ version: 2 });
      
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Draft not found for this version');
  });
});
