# KAIROS Engine — API Interna (`/internal/v1`)

**Público-alvo:** time que implementa esta API dentro do `my_ai_agents`, e time que implementa/mantém o `experia-calibration-mcp-server` (consumidor único desta API).
**Status:** Draft — cobre o contrato definido no system design de 2026-07-13 (ADR-004, Action Item 1).
**Não cobre:** rotas públicas do KAIROS Engine já existentes (`/api/manager/bot/...`) nem nada do Mission Control/LibreChat em si.

---

## Visão Geral

Esta API existe para que o `experia-calibration-mcp-server` leia e escreva config de tenant e consulte status de execução **sem acessar Mongo/Postgres/Redis diretamente**. Ela é a única porta de entrada externa para o schema interno do KAIROS Engine.

Base URL: `https://<host-do-kairos-engine>/internal/v1`

Todas as respostas são JSON. Todos os timestamps são ISO 8601 UTC.

## Autenticação

Duas camadas, obrigatórias em toda rota (exceto onde indicado):

| Header | Descrição |
|---|---|
| `Authorization: Bearer <service-token>` | Credencial de serviço do MCP server. Identifica *que sistema* está chamando, não *qual tenant*. Emitida uma vez, de longa duração, rotacionada manualmente. |
| `X-Tenant-Scope: <scope-token>` | Token curto (TTL 60s), assinado pelo MCP server no momento da chamada, contendo o `tenant_id` que aquele binding `X-Tenant-Key` está autorizado a tocar. O KAIROS Engine valida a assinatura e o `tenant_id` embutido — **nunca confia no `:tenantId` da URL sem essa validação**. |

Se `X-Tenant-Scope` não bater com o `:tenantId` da rota → `403`. Isso é intencional: é a segunda camada de defesa contra vazamento cross-tenant (requisito de segurança #1 do projeto).

`GET /internal/v1/tenants` (listagem administrativa) exige uma credencial de serviço com escopo `admin`, não um `X-Tenant-Scope` — ver seção própria abaixo.

## Endpoints

### `GET /internal/v1/tenants/:tenantId/config`

Retorna a config atual do tenant, lida de `manager_profiles` + `bot_configurations`.

**Request**
```
GET /internal/v1/tenants/felix-cell/config
Authorization: Bearer <service-token>
X-Tenant-Scope: <scope-token para felix-cell>
```

**Response `200`**
```json
{
  "tenant_id": "felix-cell",
  "version": 14,
  "profile": {
    "business_name": "Felix Cell",
    "tone": "informal, direto, emojis com moderação",
    "rules": ["nunca prometer prazo sem confirmar estoque", "..."]
  },
  "bot_config": {
    "channels": ["whatsapp"],
    "active": true
  },
  "updated_at": "2026-07-10T14:32:00Z",
  "updated_by": "gestor:felix"
}
```

**Erros**
| Código | Quando |
|---|---|
| `401` | `service-token` ausente/inválido |
| `403` | `X-Tenant-Scope` não corresponde a `:tenantId` |
| `404` | tenant não existe |

---

### `PUT /internal/v1/tenants/:tenantId/config`

Salva um **draft** — não publica. Usado quando o gestor está ajustando tom/regras no Mission Control antes de decidir publicar.

**Request**
```
PUT /internal/v1/tenants/felix-cell/config
Authorization: Bearer <service-token>
X-Tenant-Scope: <scope-token para felix-cell>
Content-Type: application/json

{
  "expected_version": 14,
  "profile": {
    "business_name": "Felix Cell",
    "tone": "informal, direto, sem emojis",
    "rules": ["nunca prometer prazo sem confirmar estoque", "..."]
  },
  "bot_config": { "channels": ["whatsapp"], "active": true }
}
```

`expected_version` é obrigatório — controle de concorrência otimista.

**Response `200`**
```json
{ "tenant_id": "felix-cell", "version": 15, "status": "draft" }
```

**Erros**
| Código | Quando |
|---|---|
| `409` | `expected_version` desatualizado (outro processo já mudou a config) — corpo inclui a config atual para o cliente comparar |
| `422` | validação de schema falhou — corpo inclui lista de campos inválidos |
| `401` / `403` | mesmo padrão acima |

---

### `POST /internal/v1/tenants/:tenantId/publish`

Ativa a config em produção. É o único endpoint que efetivamente muda o que o bot responde ao cliente final.

**Request**
```
POST /internal/v1/tenants/felix-cell/publish
Authorization: Bearer <service-token>
X-Tenant-Scope: <scope-token para felix-cell>
Content-Type: application/json

{ "version": 15 }
```

**Response `200`**
```json
{
  "tenant_id": "felix-cell",
  "version": 15,
  "status": "live",
  "published_at": "2026-07-13T18:00:00Z",
  "published_by": "gestor:felix"
}
```
Grava um registro em `publish_history` (novo — ver system design). Não requer reiniciar o processo do bot; o KAIROS Engine já sabe propagar config nova para a sessão Evolution API ativa.

**Erros**
| Código | Quando |
|---|---|
| `409` | `version` informada não é a mais recente em draft |
| `422` | draft incompleto ou inválido para publicação |
| `401` / `403` | mesmo padrão acima |

---

### `GET /internal/v1/tenants/:tenantId/status`

Status real de execução — não confundir com status de publicação.

**Request**
```
GET /internal/v1/tenants/felix-cell/status
Authorization: Bearer <service-token>
X-Tenant-Scope: <scope-token para felix-cell>
```

**Response `200` (saudável)**
```json
{
  "tenant_id": "felix-cell",
  "evolution_session": "connected",
  "queue_depth": 2,
  "last_message_processed_at": "2026-07-13T18:04:11Z",
  "last_published_version": 15,
  "degraded": false
}
```

**Response `200` (degradado — Redis ou Evolution API fora)**
```json
{
  "tenant_id": "felix-cell",
  "evolution_session": "unknown",
  "queue_depth": null,
  "last_message_processed_at": "2026-07-13T17:40:02Z",
  "last_published_version": 15,
  "degraded": true,
  "degraded_reason": "evolution_api_unreachable"
}
```
Este endpoint **não retorna `5xx` por dependência interna fora do ar** — o objetivo é o gestor ver "algo está errado" no Mission Control, não um erro genérico de API.

---

### `GET /internal/v1/tenants`

Listagem administrativa — usada pelo próprio Mission Control para introspecção/debug, não por um gestor comum calibrando o próprio tenant.

**Request**
```
GET /internal/v1/tenants
Authorization: Bearer <admin-service-token>
```
Não usa `X-Tenant-Scope` — exige credencial de serviço com escopo `admin` distinto da credencial padrão do MCP server.

**Response `200`**
```json
{
  "tenants": [
    { "tenant_id": "felix-cell", "active": true, "last_published_version": 15 },
    { "tenant_id": "bistro-56", "active": true, "last_published_version": 3 }
  ]
}
```

## Rate Limits

Não há limite agressivo nesta primeira versão — volume esperado é baixo (calibração é evento humano, não tráfego de mensagens). Recomendação: limite de segurança de 60 req/min por `tenant_id` no `PUT`/`POST` para conter loops de retry mal implementados no MCP server; sem limite prático no `GET`.

## Versionamento

Prefixo `/internal/v1` é definitivo desde o lançamento — qualquer mudança incompatível vira `/internal/v2`, mantendo `v1` funcionando até o MCP server migrar. Isso é a cláusula que evita repetir o problema do ADR-002 (consumidor externo quebrado por mudança de schema sem aviso).

## Exemplo de uso (curl)

```bash
# 1. Ler config atual
curl -H "Authorization: Bearer $SERVICE_TOKEN" \
     -H "X-Tenant-Scope: $SCOPE_TOKEN_FELIX" \
     https://kairos.internal/internal/v1/tenants/felix-cell/config

# 2. Salvar draft
curl -X PUT \
     -H "Authorization: Bearer $SERVICE_TOKEN" \
     -H "X-Tenant-Scope: $SCOPE_TOKEN_FELIX" \
     -H "Content-Type: application/json" \
     -d '{"expected_version":14,"profile":{...},"bot_config":{...}}' \
     https://kairos.internal/internal/v1/tenants/felix-cell/config

# 3. Publicar
curl -X POST \
     -H "Authorization: Bearer $SERVICE_TOKEN" \
     -H "X-Tenant-Scope: $SCOPE_TOKEN_FELIX" \
     -H "Content-Type: application/json" \
     -d '{"version":15}' \
     https://kairos.internal/internal/v1/tenants/felix-cell/publish
```

## Referências

- ADR-004 — Arquitetura Definitiva (Mission Control / KAIROS Engine)
- System Design — API Interna do KAIROS Engine (2026-07-13)
- RP-002, Seção 9 — as 7 tools do `experia-calibration-mcp-server` que consomem esta API
