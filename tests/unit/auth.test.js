const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock dependencies before requiring the router
jest.mock('../../src/services/manager-db', () => ({
  getInternalConfig: jest.fn().mockResolvedValue({ version: 1, profile: {} })
}));
jest.mock('../../src/services/redis', () => ({
  isBotOnStandby: jest.fn().mockResolvedValue(false)
}));

const internalRouter = require('../../src/routes/internal-v1');

describe('Auth & Scope Middleware Unit Tests', () => {
  let app;
  
  beforeEach(() => {
    process.env.KAIROS_INTERNAL_SERVICE_TOKEN = 'test-service-token';
    process.env.KAIROS_TENANT_SCOPE_SECRET = 'test-scope-secret';
    process.env.KAIROS_INTERNAL_ADMIN_TOKEN = 'test-admin-token';
    
    app = express();
    app.use(express.json());
    app.use('/internal/v1', internalRouter);
  });

  const validServiceToken = 'test-service-token';
  const adminToken = 'test-admin-token';
  const targetTenant = 'tenant123';
  
  const generateScopeToken = (tenantId, expiresIn = '60s') => {
    return jwt.sign({ tenant_id: tenantId }, process.env.KAIROS_TENANT_SCOPE_SECRET, { expiresIn });
  };

  test('Rejeita requisição sem Authorization header -> 401', async () => {
    const res = await request(app).get(`/internal/v1/tenants/${targetTenant}/config`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing or invalid Authorization header');
  });

  test('Rejeita requisição com service token inválido -> 401', async () => {
    const res = await request(app)
      .get(`/internal/v1/tenants/${targetTenant}/config`)
      .set('Authorization', 'Bearer token-errado');
    expect(res.status).toBe(401);
  });

  test('Rejeita requisição sem X-Tenant-Scope (e não é admin) -> 403', async () => {
    const res = await request(app)
      .get(`/internal/v1/tenants/${targetTenant}/config`)
      .set('Authorization', `Bearer ${validServiceToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Missing X-Tenant-Scope header');
  });

  test('Rejeita X-Tenant-Scope com tenant_id diferente da rota -> 403', async () => {
    const wrongScopeToken = generateScopeToken('outro-tenant');
    const res = await request(app)
      .get(`/internal/v1/tenants/${targetTenant}/config`)
      .set('Authorization', `Bearer ${validServiceToken}`)
      .set('X-Tenant-Scope', wrongScopeToken);
    
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Scope mismatch/);
  });

  test('Rejeita X-Tenant-Scope expirado -> 403', async () => {
    const expiredToken = generateScopeToken(targetTenant, '-10s');
    const res = await request(app)
      .get(`/internal/v1/tenants/${targetTenant}/config`)
      .set('Authorization', `Bearer ${validServiceToken}`)
      .set('X-Tenant-Scope', expiredToken);
    
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Invalid or expired/);
  });

  test('Aceita requisição com Service Token e Scope corretos -> 200', async () => {
    const validScopeToken = generateScopeToken(targetTenant);
    const res = await request(app)
      .get(`/internal/v1/tenants/${targetTenant}/config`)
      .set('Authorization', `Bearer ${validServiceToken}`)
      .set('X-Tenant-Scope', validScopeToken);
    
    expect(res.status).toBe(200);
  });

  test('Admin token ignora verificação de X-Tenant-Scope -> 200', async () => {
    const res = await request(app)
      .get(`/internal/v1/tenants/${targetTenant}/config`)
      .set('Authorization', `Bearer ${adminToken}`);
    
    expect(res.status).toBe(200);
  });
});
