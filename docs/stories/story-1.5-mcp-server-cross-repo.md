# Story 1.5 — Cross-Repo: Ajustar MCP Server para Consumir API Interna

**Status:** Draft  
**Sprint:** Sprint B — Integração Cross-Repo  
**Repositório:** `experia-calibration-mcp-server` ← ⚠️ FORA de `my_ai_agents`  
**Criado por:** @sm (River)  
**Referência de Arquitetura:** ADR-004 (Action Items 2 e 5) · `api-docs-kairos-engine-internal-v1.md`  
**Restrições-Mãe:** #2 (Zero acesso direto ao BD) · #3 (Autenticação dupla) · #6 (Versionamento)

---

## ⚠️ Aviso de Dependência Cross-Repo

> Esta story **não é implementada** no repositório `my_ai_agents`. O trabalho ocorre em `experia-calibration-mcp-server` (dentro de `Experia-agents-lab/experia-calibration-mcp-server/`). Ela está registrada aqui para rastreabilidade da dependência externa, conforme requisito do handoff original (Seção 5 do Handoff, item 5).
>
> **Gate de entrada:** Story 1.2 (Endpoints `/internal/v1`) deve estar concluída e validada antes de iniciar esta story.

## Contexto

O `experia-calibration-mcp-server` possui 7 tools que atualmente têm a lógica de dados incompleta ou apontando para destinos incorretos. Com a API interna do KAIROS Engine disponível, todas as tools devem passar a fazer chamadas HTTP autenticadas para `/internal/v1` em vez de acessar o banco diretamente ou simular respostas.

## Story

**Como** o `experia-calibration-mcp-server` (único consumidor da API interna),  
**Quero** que cada uma das 7 tools faça chamadas HTTP para `/internal/v1` com autenticação dupla (`Bearer` + `X-Tenant-Scope` como JWT),  
**Para que** a calibração feita pelo gestor no Mission Control (LibreChat) se propague corretamente para o bot em produção no KAIROS Engine.

## Mapeamento das 7 Tools → Endpoints

| Tool do MCP Server | Endpoint Correspondente | Operação |
|---|---|---|
| `calibration_get_config` | `GET /internal/v1/tenants/:tenantId/config` | Leitura |
| `calibration_update_config` | `PUT /internal/v1/tenants/:tenantId/config` | Draft |
| `calibration_publish_agent` | `POST /internal/v1/tenants/:tenantId/publish` | Publicação |
| `calibration_get_status` | `GET /internal/v1/tenants/:tenantId/status` | Status real |
| `calibration_list_tenants` | `GET /internal/v1/tenants` | Lista (admin) |
| `calibration_register_tenant` | Fluxo próprio → `PUT` inicial de config | Criação |
| `calibration_rollback` | `POST /publish` com versão anterior | Rollback |

## Critérios de Aceite

### Geração do `X-Tenant-Scope` JWT
- [ ] O MCP server possui uma função utilitária `generateTenantScopeToken(tenantId, secret, ttlSeconds=60)` que emite um JWT assinado com `KAIROS_TENANT_SCOPE_SECRET`.
- [ ] O token é gerado **no momento da chamada** (TTL 60s), nunca em cache de longa duração.
- [ ] O `tenant_id` embutido no JWT é sempre resolvido server-side a partir do binding `X-Tenant-Key` — **nunca** é input direto da tool ou do gestor.

### HTTP Client
- [ ] Todas as tools usam um cliente HTTP centralizado (ex: `fetch` ou `axios`) que injeta automaticamente `Authorization: Bearer <SERVICE_TOKEN>` e `X-Tenant-Scope: <jwt>`.
- [ ] Variáveis necessárias no `.env` do MCP server: `KAIROS_ENGINE_BASE_URL`, `KAIROS_INTERNAL_SERVICE_TOKEN`, `KAIROS_TENANT_SCOPE_SECRET`.

### Mapeamento de Erros
- [ ] `401` da API → MCP server retorna erro de autenticação (não expõe detalhe ao gestor).
- [ ] `403` da API → MCP server retorna "Acesso negado para este tenant" (não expõe detalhe).
- [ ] `409` da API → MCP server exibe mensagem de conflito de versão ao gestor e busca a config atual.
- [ ] `503` da API → MCP server retorna erro de indisponibilidade temporária com orientação de retry.

### Compatibilidade com `_test-tenant`
- [ ] As tools podem ser testadas manualmente contra o `_test-tenant` sem modificar nenhum tenant de produção.

## Definição de Pronto (DoD)

- [ ] As 7 tools fazem chamadas reais para a API (confirmado por log no KAIROS Engine).
- [ ] `calibration_publish_agent` propaga a config e o gestor vê `status: "live"` no retorno da tool.
- [ ] `calibration_get_status` exibe `evolution_session` e `last_published_version` reais.
- [ ] `.env.example` do MCP server atualizado com as 3 novas variáveis.
- [ ] @sm valida que nenhuma tool acessa Mongo/Postgres/Redis diretamente.

## Dependências

- **Bloqueia:** Story 1.6 (Contract Tests)
- **Bloqueada por:** Story 1.2 (Endpoints devem estar funcionando)
- **Repositório:** `experia-calibration-mcp-server` (cross-repo — sinalização obrigatória)

## Referências

- [api-docs-kairos-engine-internal-v1.md](../architecture/api-docs-kairos-engine-internal-v1.md) — Contratos que as tools devem respeitar
- [ADR-004](../architecture/adr/ADR-004-arquitetura-definitiva-experia-ai-agents.md) — Action Items 2 e 5, Restrições #2 e #3
- `src/tools.ts` em `experia-calibration-mcp-server` — arquivo a modificar
