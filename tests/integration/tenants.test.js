const express = require('express');
const request = require('supertest');

const dbSetup = require('./db-setup');
const db = require('../../src/services/manager-db');

const internalRouter = require('../../src/routes/internal-v1');

let app;

beforeAll(async () => {
  await dbSetup.connect();
  
  process.env.KAIROS_INTERNAL_SERVICE_TOKEN = 'int-test-token';
  process.env.KAIROS_INTERNAL_ADMIN_TOKEN = 'int-admin-token';
  
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

describe('GET /tenants', () => {
  const adminToken = 'int-admin-token';
  const serviceToken = 'int-test-token';
  
  test('Retorna lista de tenants se usar admin token', async () => {
    const connection = await db.connect();
    await connection.collection('manager_profiles').insertMany([
      { manager_id: 'tenant1', business_name: 'Business 1', test: false },
      { manager_id: 'tenant2', business_name: 'Business 2', test: true }
    ]);
    
    const res = await request(app)
      .get('/internal/v1/tenants')
      .set('Authorization', `Bearer ${adminToken}`);
      
    expect(res.status).toBe(200);
    expect(res.body.tenants).toBeDefined();
    // A função getAllTenantsInternal já deve retornar arrays, validamos que está lá
    expect(Array.isArray(res.body.tenants)).toBe(true);
  });
  
  test('Retorna 403 se usar service token normal (não admin)', async () => {
    const res = await request(app)
      .get('/internal/v1/tenants')
      .set('Authorization', `Bearer ${serviceToken}`);
      
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin scope required');
  });
});
