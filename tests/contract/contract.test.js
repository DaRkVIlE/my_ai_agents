/**
 * Story 1.6 — Contract Tests (API Schema Validation)
 *
 * Objetivo: garantir que as respostas da /internal/v1 sempre conformam
 * os JSON Schemas em contracts/v1/. Estes testes usam mocks do DB
 * para não depender de MongoMemoryServer (problema de compatibilidade no Windows).
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

// ── Mocks ANTES de carregar o router ───────────────────────────────────────
jest.mock('../../src/services/manager-db');
jest.mock('../../src/services/redis');

const db = require('../../src/services/manager-db');
const redis = require('../../src/services/redis');
const internalRouter = require('../../src/routes/internal-v1');

// ── Setup ──────────────────────────────────────────────────────────────────
const SERVICE_TOKEN = 'contract-service-token';
const SCOPE_SECRET = 'contract-scope-secret';
const ADMIN_TOKEN = 'contract-admin-token';
const TENANT_ID = 'tenant-contract-test';

let app;
const ajv = new Ajv({ strict: false });

const loadSchema = (filename) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '../../contracts/v1', filename), 'utf8'));

const generateScopeToken = (tenantId = TENANT_ID) =>
  jwt.sign({ tenant_id: tenantId }, SCOPE_SECRET, { expiresIn: '60s' });

beforeAll(() => {
  process.env.KAIROS_INTERNAL_SERVICE_TOKEN = SERVICE_TOKEN;
  process.env.KAIROS_TENANT_SCOPE_SECRET = SCOPE_SECRET;
  process.env.KAIROS_INTERNAL_ADMIN_TOKEN = ADMIN_TOKEN;

  app = express();
  app.use(express.json());
  app.use('/internal/v1', internalRouter);
});

beforeEach(() => {
  jest.clearAllMocks();
  redis.isBotOnStandby = jest.fn().mockResolvedValue(false);
});

// ── Helpers de mock ────────────────────────────────────────────────────────
const mockGetInternalConfig = (version = 1) => {
  db.getInternalConfig = jest.fn().mockResolvedValue({
    tenant_id: TENANT_ID,
    version,
    profile: { business_name: 'Test Business', bot_status: 'active' },
    bot_config: { tone: 'professional', channels: ['whatsapp'] },
    updated_at: new Date().toISOString(),
    updated_by: 'system'
  });
};

// ══════════════════════════════════════════════════════════════════════════
// GET /config
// ══════════════════════════════════════════════════════════════════════════
describe('Contract: GET /config → get-config.json', () => {
  const schema = loadSchema('get-config.json');
  const validate = ajv.compile(schema);

  test('Resposta 200 conforma ao schema', async () => {
    mockGetInternalConfig(3);
    const scopeToken = generateScopeToken();

    const res = await request(app)
      .get(`/internal/v1/tenants/${TENANT_ID}/config`)
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
      .set('X-Tenant-Scope', scopeToken);

    expect(res.status).toBe(200);
    const valid = validate(res.body);
    if (!valid) console.error('Schema errors:', validate.errors);
    expect(valid).toBe(true);
  });

  test('Resposta 404 quando tenant não encontrado', async () => {
    db.getInternalConfig = jest.fn().mockResolvedValue({ profile: null });
    const scopeToken = generateScopeToken();

    const res = await request(app)
      .get(`/internal/v1/tenants/${TENANT_ID}/config`)
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
      .set('X-Tenant-Scope', scopeToken);

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// PUT /config
// ══════════════════════════════════════════════════════════════════════════
describe('Contract: PUT /config → put-config-request/response.json', () => {
  const reqSchema = loadSchema('put-config-request.json');
  const resSchema = loadSchema('put-config-response.json');
  const validateReq = ajv.compile(reqSchema);
  const validateRes = ajv.compile(resSchema);

  test('Payload de request conforma ao schema', () => {
    const payload = { expected_version: 1, bot_config: { tone: 'friendly' } };
    expect(validateReq(payload)).toBe(true);
  });

  test('Payload sem expected_version é inválido no schema', () => {
    const payload = { bot_config: { tone: 'friendly' } };
    expect(validateReq(payload)).toBe(false);
  });

  test('Resposta 200 conforma ao schema', async () => {
    mockGetInternalConfig(1);
    db.saveInternalConfigDraft = jest.fn().mockResolvedValue(2);
    const scopeToken = generateScopeToken();

    const res = await request(app)
      .put(`/internal/v1/tenants/${TENANT_ID}/config`)
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
      .set('X-Tenant-Scope', scopeToken)
      .send({ expected_version: 1, bot_config: { tone: 'friendly' } });

    expect(res.status).toBe(200);
    const valid = validateRes(res.body);
    if (!valid) console.error('Schema errors:', validateRes.errors);
    expect(valid).toBe(true);
    // Valores semânticos
    expect(res.body.tenant_id).toBe(TENANT_ID);
    expect(res.body.version).toBe(2);
    expect(res.body.status).toBe('draft');
  });

  test('Resposta 422 quando expected_version ausente', async () => {
    const scopeToken = generateScopeToken();

    const res = await request(app)
      .put(`/internal/v1/tenants/${TENANT_ID}/config`)
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
      .set('X-Tenant-Scope', scopeToken)
      .send({ bot_config: {} });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Missing expected_version');
  });

  test('Resposta 409 em conflito de versão', async () => {
    mockGetInternalConfig(5);
    db.saveInternalConfigDraft = jest.fn().mockRejectedValue(
      new Error('CONFLICT: expected 1 but got 5')
    );
    const scopeToken = generateScopeToken();

    const res = await request(app)
      .put(`/internal/v1/tenants/${TENANT_ID}/config`)
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
      .set('X-Tenant-Scope', scopeToken)
      .send({ expected_version: 1, bot_config: {} });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/CONFLICT/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// POST /publish
// ══════════════════════════════════════════════════════════════════════════
describe('Contract: POST /publish → post-publish-request/response.json', () => {
  const reqSchema = loadSchema('post-publish-request.json');
  const resSchema = loadSchema('post-publish-response.json');
  const validateReq = ajv.compile(reqSchema);
  const validateRes = ajv.compile(resSchema);

  test('Payload de request conforma ao schema', () => {
    expect(validateReq({ version: 3 })).toBe(true);
  });

  test('Payload sem version é inválido no schema', () => {
    expect(validateReq({})).toBe(false);
  });

  test('Resposta 200 conforma ao schema', async () => {
    const publishedAt = new Date();
    db.publishInternalConfig = jest.fn().mockResolvedValue(publishedAt);
    const scopeToken = generateScopeToken();

    const res = await request(app)
      .post(`/internal/v1/tenants/${TENANT_ID}/publish`)
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
      .set('X-Tenant-Scope', scopeToken)
      .send({ version: 3 });

    expect(res.status).toBe(200);
    const valid = validateRes(res.body);
    if (!valid) console.error('Schema errors:', validateRes.errors);
    expect(valid).toBe(true);
    expect(res.body.status).toBe('live');
    expect(res.body.version).toBe(3);
  });

  test('Resposta 409 quando draft não encontrado', async () => {
    db.publishInternalConfig = jest.fn().mockRejectedValue(
      new Error('Draft not found for this version')
    );
    const scopeToken = generateScopeToken();

    const res = await request(app)
      .post(`/internal/v1/tenants/${TENANT_ID}/publish`)
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
      .set('X-Tenant-Scope', scopeToken)
      .send({ version: 99 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Draft not found for this version');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GET /status
// ══════════════════════════════════════════════════════════════════════════
describe('Contract: GET /status → get-status-response.json', () => {
  const schema = loadSchema('get-status-response.json');
  const validate = ajv.compile(schema);

  test('Resposta 200 (healthy) conforma ao schema', async () => {
    db.getLastPublish = jest.fn().mockResolvedValue({ version: 5 });
    redis.isBotOnStandby = jest.fn().mockResolvedValue(false);
    const scopeToken = generateScopeToken();

    const res = await request(app)
      .get(`/internal/v1/tenants/${TENANT_ID}/status`)
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
      .set('X-Tenant-Scope', scopeToken);

    expect(res.status).toBe(200);
    const valid = validate(res.body);
    if (!valid) console.error('Schema errors:', validate.errors);
    expect(valid).toBe(true);
    expect(res.body.degraded).toBe(false);
    expect(res.body.evolution_session).toBe('connected');
    expect(res.body.last_published_version).toBe(5);
  });

  test('Resposta 200 (degraded) conforma ao schema quando Redis falha', async () => {
    db.getLastPublish = jest.fn().mockResolvedValue(null);
    redis.isBotOnStandby = jest.fn().mockRejectedValue(new Error('Redis timeout'));
    const scopeToken = generateScopeToken();

    const res = await request(app)
      .get(`/internal/v1/tenants/${TENANT_ID}/status`)
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`)
      .set('X-Tenant-Scope', scopeToken);

    expect(res.status).toBe(200); // NUNCA 5xx no /status
    const valid = validate(res.body);
    if (!valid) console.error('Schema errors:', validate.errors);
    expect(valid).toBe(true);
    expect(res.body.degraded).toBe(true);
    expect(res.body.evolution_session).toBe('unknown');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// GET /tenants (Admin)
// ══════════════════════════════════════════════════════════════════════════
describe('Contract: GET /tenants → get-tenants-response.json', () => {
  const schema = loadSchema('get-tenants-response.json');
  const validate = ajv.compile(schema);

  test('Resposta 200 (admin) conforma ao schema', async () => {
    db.getAllTenantsInternal = jest.fn().mockResolvedValue([
      { tenant_id: 'tenant1', active: true, last_published_version: 3 },
      { tenant_id: 'tenant2', active: false, last_published_version: 1 }
    ]);

    const res = await request(app)
      .get('/internal/v1/tenants')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const valid = validate(res.body);
    if (!valid) console.error('Schema errors:', validate.errors);
    expect(valid).toBe(true);
    expect(Array.isArray(res.body.tenants)).toBe(true);
  });

  test('Retorna 403 para service token não-admin', async () => {
    const res = await request(app)
      .get('/internal/v1/tenants')
      .set('Authorization', `Bearer ${SERVICE_TOKEN}`);

    expect(res.status).toBe(403);
  });
});
