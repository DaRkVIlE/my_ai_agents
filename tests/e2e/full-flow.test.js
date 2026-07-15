require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const express = require('express');
const app = express();
const internalRouter = require('../../src/routes/internal-v1');
app.use(express.json());
app.use('/internal/v1', internalRouter);

const db = require('../../src/services/manager-db');

// Este E2E assume que o servidor Express pode ser instanciado para o teste
// Alternativamente, poderia apontar para um host real (http://localhost:8080)

describe('E2E Full Flow - API Interna contra _test-tenant', () => {
  const tenantId = process.env.TEST_TENANT_ID || '_test-tenant';
  const serviceToken = process.env.KAIROS_INTERNAL_SERVICE_TOKEN;
  const scopeSecret = process.env.KAIROS_TENANT_SCOPE_SECRET;
  
  // Vamos usar um timeout maior para o banco de dados real
  jest.setTimeout(30000);
  
  beforeAll(async () => {
    // Conecta ao banco real
    if (serviceToken && scopeSecret && process.env.MONGODB_URI) {
      await db.connect();
    }
  });

  afterAll(async () => {
    if (serviceToken && scopeSecret && process.env.MONGODB_URI) {
      await db.disconnect();
    }
  });
  
  const generateScopeToken = () => {
    return jwt.sign({ tenant_id: tenantId }, scopeSecret, { expiresIn: '60s' });
  };
  
  let currentVersion = 1;

  test('Pula o E2E se faltarem variáveis de ambiente', () => {
    if (!serviceToken || !scopeSecret || !process.env.MONGODB_URI) {
      console.warn('E2E skipped due to missing KAIROS_INTERNAL_SERVICE_TOKEN, KAIROS_TENANT_SCOPE_SECRET or MONGODB_URI');
      expect(true).toBe(true);
    }
  });

  if (serviceToken && scopeSecret && process.env.MONGODB_URI) {
    test('1. GET /config - Obtém a versão inicial', async () => {
      const scopeToken = generateScopeToken();
      const res = await request(app)
        .get(`/internal/v1/tenants/${tenantId}/config`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .set('X-Tenant-Scope', scopeToken);
        
      expect(res.status).toBe(200);
      expect(res.body.version).toBeDefined();
      currentVersion = res.body.version;
    });
    
    test('2. PUT /config - Cria um draft com versão atualizada', async () => {
      const scopeToken = generateScopeToken();
      const res = await request(app)
        .put(`/internal/v1/tenants/${tenantId}/config`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .set('X-Tenant-Scope', scopeToken)
        .send({
          expected_version: currentVersion,
          bot_config: { test_e2e: true, timestamp: Date.now() }
        });
        
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(currentVersion + 1);
      expect(res.body.status).toBe('draft');
      
      currentVersion = res.body.version;
    });
    
    test('3. POST /publish - Publica o draft', async () => {
      const scopeToken = generateScopeToken();
      const res = await request(app)
        .post(`/internal/v1/tenants/${tenantId}/publish`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .set('X-Tenant-Scope', scopeToken)
        .send({ version: currentVersion });
        
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('live');
      expect(res.body.version).toBe(currentVersion);
    });
    
    test('4. GET /status - Confirma a última versão publicada', async () => {
      const scopeToken = generateScopeToken();
      const res = await request(app)
        .get(`/internal/v1/tenants/${tenantId}/status`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .set('X-Tenant-Scope', scopeToken);
        
      expect(res.status).toBe(200);
      expect(res.body.last_published_version).toBe(currentVersion);
    });
    
    test('5. POST /publish - Rollback (Publicar versão N-1)', async () => {
      // Re-publicar a versão anterior (se existir)
      if (currentVersion > 1) {
        const rollbackVersion = currentVersion - 1;
        const scopeToken = generateScopeToken();
        const res = await request(app)
          .post(`/internal/v1/tenants/${tenantId}/publish`)
          .set('Authorization', `Bearer ${serviceToken}`)
          .set('X-Tenant-Scope', scopeToken)
          .send({ version: rollbackVersion });
          
        expect(res.status).toBe(200);
        expect(res.body.version).toBe(rollbackVersion);
        expect(res.body.status).toBe('live');
      }
    });
  }
});
