# Story 1.2 — Implementar Endpoints `/internal/v1`

**Status:** Draft  
**Sprint:** Sprint A — Fundação da API Interna  
**Repositório:** `my_ai_agents`  
**Criado por:** @sm (River)  
**Referência de Arquitetura:** ADR-004 · `api-docs-kairos-engine-internal-v1.md` · `system-design-kairos-engine-internal-api.md`  
**Restrições-Mãe:** #1 (Zero Downtime) · #2 (Zero acesso externo direto a BD) · #3 (Autenticação dupla) · #6 (Versionamento `/internal/v1`)

---

## Contexto

A rota `/internal/v1` expõe a única superfície externa do KAIROS Engine ao `experia-calibration-mcp-server`. O arquivo `src/routes/internal-v1.js` já foi criado com o esqueleto — esta story formaliza o contrato de qualidade e completude que o @dev deve garantir antes de marcar como concluído.

> **Nota @dev:** O esqueleto já existe em `src/routes/internal-v1.js` e o router já está registrado em `src/index.js` como `/internal/v1`. O trabalho é completar, validar e garantir os critérios de aceite abaixo.

## Story

**Como** o `experia-calibration-mcp-server` (consumidor único),  
**Quero** uma API interna versionada (`/internal/v1`) no KAIROS Engine com 5 endpoints de config/status,  
**Para que** eu possa ler, rascunhar e publicar configurações de tenant sem acessar o banco de dados diretamente.

## Endpoints a Implementar

| Método | Rota | Função |
|--------|------|--------|
| `GET`  | `/internal/v1/tenants/:tenantId/config` | Lê config atual do tenant |
| `PUT`  | `/internal/v1/tenants/:tenantId/config` | Salva draft (não publica) |
| `POST` | `/internal/v1/tenants/:tenantId/publish` | Ativa config em produção |
| `GET`  | `/internal/v1/tenants/:tenantId/status` | Status real de execução (Redis + Evolution) |
| `GET`  | `/internal/v1/tenants` | Lista todos os tenants (Admin Only) |

## Critérios de Aceite

### Autenticação (Regra #3 — não-negociável)
- [ ] Toda rota valida `Authorization: Bearer <service-token>` contra `process.env.KAIROS_INTERNAL_SERVICE_TOKEN`.
- [ ] Toda rota com `:tenantId` valida o header `X-Tenant-Scope` como JWT assinado com `process.env.KAIROS_TENANT_SCOPE_SECRET` e verifica que o campo `tenant_id` dentro do JWT corresponde ao `:tenantId` da URL.
- [ ] Se `X-Tenant-Scope.tenant_id !== :tenantId` → resposta obrigatória é `403` (nunca `200` ou `404`).
- [ ] `GET /tenants` (admin) exige token de admin distinto (`KAIROS_INTERNAL_ADMIN_TOKEN`) e **não aceita** `X-Tenant-Scope` no lugar.

### Contratos de Response (conforme `api-docs-kairos-engine-internal-v1.md`)
- [ ] `GET /config` retorna `{ tenant_id, version, profile, bot_config, updated_at, updated_by }` com `version` sempre presente.
- [ ] `PUT /config` retorna `{ tenant_id, version, status: "draft" }` em `200`; retorna `409` com a config atual no corpo quando `expected_version` está desatualizado.
- [ ] `POST /publish` retorna `{ tenant_id, version, status: "live", published_at, published_by }` e grava em `publish_history`.
- [ ] `GET /status` **nunca** retorna `5xx` por dependência interna fora do ar — retorna `200` com `degraded: true` e o motivo.
- [ ] `GET /tenants` retorna `{ tenants: [{ tenant_id, active, last_published_version }] }`.

### Zero Downtime (Regra #1 — não-negociável)
- [ ] O router `/internal/v1` está montado **sem bloquear** o event loop do webhook. Nenhuma operação de banco neste router pode ser síncrona-bloqueante.
- [ ] Confirmar (manual ou via teste) que o webhook `/api/webhook/:clientId` continua respondendo durante uma chamada simultânea à `/internal/v1`.

### Variáveis de Ambiente
- [ ] `.env.example` contém: `KAIROS_INTERNAL_SERVICE_TOKEN`, `KAIROS_TENANT_SCOPE_SECRET`, `KAIROS_INTERNAL_ADMIN_TOKEN`.

## Definição de Pronto (DoD)

- [ ] Todos os 5 endpoints retornam os contratos corretos (validado via curl ou teste de integração).
- [ ] Todos os casos de `401`, `403`, `404`, `409`, `422` estão implementados e testáveis.
- [ ] `GET /status` retorna `degraded: true` quando Redis está fora (simulado por mock).
- [ ] `.env.example` atualizado.
- [ ] @sm revisou que nenhuma rota expõe campos de schema interno (ex: `_id` do Mongo) diretamente.

## Dependências

- **Bloqueia:** Story 1.4 (Testes), Story 1.5 (MCP Server Cross-Repo)
- **Bloqueada por:** Story 1.1 (`_test-tenant` deve existir para testes manuais)
- **Paralela a:** Story 1.3 (Schema do BD)

## Referências

- [api-docs-kairos-engine-internal-v1.md](../architecture/api-docs-kairos-engine-internal-v1.md) — Contrato completo de request/response
- [system-design-kairos-engine-internal-api.md](../architecture/system-design-kairos-engine-internal-api.md) — Seção 5 (Erros e Retry)
- [ADR-004](../architecture/adr/ADR-004-arquitetura-definitiva-experia-ai-agents.md) — Restrições #2, #3, #6
- Arquivo existente: `src/routes/internal-v1.js` (esqueleto a completar)
