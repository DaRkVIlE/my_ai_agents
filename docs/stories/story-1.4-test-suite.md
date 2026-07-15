# Story 1.4 — Implementar Suite de Testes da API Interna

**Status:** Draft  
**Sprint:** Sprint A — Fundação da API Interna  
**Repositório:** `my_ai_agents`  
**Criado por:** @sm (River)  
**Referência de Arquitetura:** ADR-004 · `test-strategy-kairos-engine-internal-api.md` (fonte de verdade desta story)  
**Restrições-Mãe:** #1 (Zero Downtime) · #4 (Nunca testar contra tenant real)

---

## Contexto

A estratégia de teste já foi definida formalmente em `test-strategy-kairos-engine-internal-api.md`. O papel do @dev aqui é implementar — **não redesenhar** — a cobertura descrita naquele documento. O @qa irá auditar se os testes gerados cobrem a tabela de casos por endpoint da Seção "Casos de Teste por Endpoint".

> **@dev:** Você **não tem autonomia** para omitir categorias de teste ou redefinir critérios de aceite. Se houver impedimento técnico (ex: impossível simular Redis offline no ambiente), escale para @sm antes de pular o caso.

## Story

**Como** o time de qualidade (Experia),  
**Quero** uma suite de testes automatizados para a API `/internal/v1` dividida em 4 camadas (unit, integração, security boundary, E2E),  
**Para que** qualquer mudança na API ou no MCP server que quebre o contrato seja detectada antes de atingir produção.

## Critérios de Aceite por Camada

### Camada 1 — Unit Tests (meta: ~90%+ de cobertura em lógica pura)
- [ ] Teste: `verifyTenantScope` rejeita token com `tenant_id` errado → `403`
- [ ] Teste: `verifyTenantScope` rejeita token expirado → `403`
- [ ] Teste: `verifyServiceToken` rejeita Bearer inválido → `401`
- [ ] Teste: `saveInternalConfigDraft` lança `CONFLICT:` quando `expected_version` ≠ versão atual
- [ ] Teste: `PUT /config` sem `expected_version` no body → `422`
- [ ] Teste: `POST /publish` sem `version` no body → `422`
- [ ] Todos os unit tests rodam sem I/O real (banco mockado)

### Camada 2 — Integration Tests (todos os endpoints, todos os códigos de erro documentados)

Baseados na tabela da Seção "Casos de Teste por Endpoint" do `test-strategy-kairos-engine-internal-api.md`:

**`GET /config`**
- [ ] Tenant existe, escopo correto → `200` com `version` presente
- [ ] Tenant não existe → `404`
- [ ] `service-token` ausente → `401`

**`PUT /config`**
- [ ] `expected_version` correta → `200`, versão incrementa, draft salvo no MongoDB
- [ ] `expected_version` desatualizada → `409` com config atual no corpo
- [ ] Payload inválido (campo obrigatório faltando) → `422`
- [ ] Duas escritas concorrentes na mesma versão → uma `200`, outra `409` (sem corrupção)

**`POST /publish`**
- [ ] Versão em draft é a mais recente → `200`, registro em `publish_history`
- [ ] Versão informada não é a mais recente → `409`

**`GET /status`**
- [ ] Tudo saudável → `degraded: false`, todos os campos presentes
- [ ] Redis fora (simulado por mock) → `200`, `degraded: true`, `queue_depth: null`
- [ ] Evolution API fora (simulado) → `200`, `degraded: true`, `evolution_session: "unknown"`

**`GET /tenants` (admin)**
- [ ] Credencial admin válida → `200` com lista completa

### Camada 3 — Security Boundary Tests (100% dos endpoints com escopo errado)
- [ ] `GET /config` com `X-Tenant-Scope` de outro tenant → `403`, nenhum campo da config vazado
- [ ] `PUT /config` com escopo errado → `403`, draft do tenant-alvo **não alterado**
- [ ] `POST /publish` com escopo errado → `403`, nenhuma publicação ocorre
- [ ] `GET /status` com escopo errado → `403`
- [ ] `GET /tenants` com credencial de tenant comum (não-admin) → `403`

### Camada 4 — E2E (apenas contra `_test-tenant`, nunca contra Felix Cell)
- [ ] Fluxo completo: `GET config` → `PUT config` (draft) → `POST publish` → `GET status` confirma `last_published_version` atualizado
- [ ] `POST /publish` no `_test-tenant` **não derruba a sessão Evolution API** — verificar que sessão permanece `connected` antes e depois da publicação
- [ ] Rollback: publicar versão anterior funciona (publish de versão N-1 após ter versão N ativa)

## Estrutura de Arquivos Esperada

```
tests/
  unit/
    auth.test.js          # verifyServiceToken, verifyTenantScope
    conflict.test.js      # concorrência otimista de versão
    validation.test.js    # 422s de payload inválido
  integration/
    config.test.js        # GET/PUT /config
    publish.test.js       # POST /publish
    status.test.js        # GET /status
    tenants.test.js       # GET /tenants
  security/
    boundary.test.js      # Todos os endpoints com escopo errado
  e2e/
    full-flow.test.js     # Fluxo completo contra _test-tenant
```

## Definição de Pronto (DoD)

- [ ] `npm test` roda sem erros.
- [ ] Todos os casos de teste das 3 primeiras camadas passam.
- [ ] E2E passa contra `_test-tenant` (não requer staging isolado completo para esta sprint — aceitável rodar contra Atlas de dev com `_test-tenant`).
- [ ] @qa auditou a cobertura contra a tabela do `test-strategy-kairos-engine-internal-api.md` e confirmou que nenhuma linha foi omitida sem justificativa.
- [ ] Nenhum teste referencia `felix-cell`, `bistro-56` ou qualquer outro `tenant_id` de produção como valor hardcoded.

## Dependências

- **Bloqueia:** Story 1.6 (Contract Tests)
- **Bloqueada por:** Story 1.1 (`_test-tenant`), Story 1.2 (Endpoints), Story 1.3 (Schema)
- **@qa:** Responsável pela auditoria de cobertura após entrega do @dev

## Referências

- [test-strategy-kairos-engine-internal-api.md](../architecture/test-strategy-kairos-engine-internal-api.md) — **Fonte de verdade desta story. Não reinventar.**
- [api-docs-kairos-engine-internal-v1.md](../architecture/api-docs-kairos-engine-internal-v1.md) — Contratos de request/response
- [ADR-004](../architecture/adr/ADR-004-arquitetura-definitiva-experia-ai-agents.md) — Restrições #4 e #1
