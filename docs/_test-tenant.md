# _test-tenant — Ambiente de Teste Isolado

**Status:** Ativo  
**Criado em:** 2026-07-15  
**Criado por:** @sm (Story 1.1)  
**Propósito:** Único tenant autorizado para testes de integração, security boundary e E2E da API `/internal/v1`. Nunca associado a cliente real.

---

## ⚠️ Regras de Uso

1. **NUNCA** usar `felix-cell`, `bistro-56`, `porto-alemao` ou qualquer outro `tenant_id` de produção em testes.
2. Qualquer script de teste que precisar de um `tenantId` hardcoded usa `_test-tenant`.
3. O `_test-tenant` tem `test: true` no MongoDB — qualquer query que sirva clientes reais deve filtrar `{ test: { $ne: true } }`.

---

## Configuração no MongoDB Atlas

### Documento em `manager_profiles`

```json
{
  "manager_id": "_test-tenant",
  "username": "test-tenant-bot",
  "business_name": "Experia Test Environment",
  "test": true,
  "first_access": false,
  "onboarding_completed": true,
  "onboarding_step": 5,
  "created_at": "2026-07-15T00:00:00.000Z",
  "updated_at": "2026-07-15T00:00:00.000Z",
  "config": {
    "tone": "neutro, direto",
    "services": ["teste de integração", "smoke test", "E2E"],
    "hours": "24/7",
    "reservation_rules": null,
    "examples": ["Mensagem de teste"],
    "bot_status": "test"
  },
  "stats": {
    "messages_sent": 0,
    "messages_received": 0,
    "total_chats": 0,
    "satisfaction_score": 0
  }
}
```

### Documento inicial em `bot_configurations`

```json
{
  "manager_id": "_test-tenant",
  "version": 1,
  "config": {
    "channels": ["whatsapp"],
    "active": false
  },
  "created_at": "2026-07-15T00:00:00.000Z",
  "status": "active"
}
```

### Para inserir no Atlas (execute `node scripts/seed-test-tenant.js`)

O script de seeding está em `scripts/seed-test-tenant.js`.

---

## Configuração na Evolution API

| Campo | Valor |
|---|---|
| `instanceName` | `_test-instance` |
| `apiKey` | Configurar em `EVOLUTION_TEST_APIKEY` no `.env` |
| Número WhatsApp | Número dedicado exclusivamente a testes (não pertence a nenhum cliente) |
| Status | Pode permanecer desconectado quando não houver E2E rodando |

> **Nota:** A sessão Evolution API do `_test-tenant` **não precisa estar permanentemente conectada**. Ela é ativada apenas durante a execução de testes E2E.

---

## Variáveis de Ambiente

```env
TEST_TENANT_ID=_test-tenant
```

---

## Como Gerar Tokens de Desenvolvimento

```bash
# Service Token (para KAIROS_INTERNAL_SERVICE_TOKEN)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Admin Token (para KAIROS_INTERNAL_ADMIN_TOKEN)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Scope Secret (para KAIROS_TENANT_SCOPE_SECRET — mesmo no MCP server)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Como Gerar um X-Tenant-Scope JWT para Testes Manuais

```js
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { tenant_id: '_test-tenant' },
  process.env.KAIROS_TENANT_SCOPE_SECRET,
  { expiresIn: '60s' }
);
console.log(token);
```

Ou execute: `node scripts/gen-test-scope-token.js`

---

## Verificação (após seeding)

```bash
# 1. Verificar que _test-tenant existe no Atlas
node -e "require('dotenv').config(); const db = require('./src/services/manager-db'); db.connect().then(d => d.collection('manager_profiles').findOne({manager_id:'_test-tenant'})).then(r => console.log(JSON.stringify(r,null,2))).catch(console.error)"

# 2. Testar GET /config (requer server rodando)
curl -H "Authorization: Bearer $KAIROS_INTERNAL_SERVICE_TOKEN" \
     -H "X-Tenant-Scope: $(node scripts/gen-test-scope-token.js)" \
     http://localhost:8080/internal/v1/tenants/_test-tenant/config
```
