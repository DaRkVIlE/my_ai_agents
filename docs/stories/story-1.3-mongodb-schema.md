# Story 1.3 — Ajustes e Novas Collections no MongoDB

**Status:** Draft  
**Sprint:** Sprint A — Fundação da API Interna  
**Repositório:** `my_ai_agents`  
**Criado por:** @sm (River)  
**Referência de Arquitetura:** ADR-004 (Action Item 3) · `system-design-kairos-engine-internal-api.md` (Seção 4 — Modelo de Dados)  
**Restrições-Mãe:** #1 (Zero Downtime) · #5 (`manager_profiles` e `bot_configurations` são fonte de verdade)

---

## Contexto

A API interna precisa de dois ajustes de modelo de dados no MongoDB: o campo `version` em `bot_configurations` (já existe parcialmente, mas sem garantia de default) e a coleção nova `publish_history`. Esta story **não inclui migração de dados** — documentos existentes ficam como estão.

> **@dev:** O arquivo `src/services/manager-db.js` já foi atualizado com as funções `getInternalConfig`, `saveInternalConfigDraft`, `publishInternalConfig`, `getLastPublish` e `getAllTenantsInternal`. Esta story valida que os schemas e índices estão corretos no banco real.

## Story

**Como** a API interna `/internal/v1`,  
**Quero** que `bot_configurations` tenha um campo `version` com default confiável e que exista a coleção `publish_history`,  
**Para que** o controle de concorrência otimista e o registro de auditoria de publicações funcionem corretamente.

## Critérios de Aceite

### Campo `version` em `bot_configurations` (Regra #5 — não-negociável)
- [ ] Qualquer novo documento inserido em `bot_configurations` via `saveInternalConfigDraft` inclui o campo `version` como número inteiro ≥ 1.
- [ ] Documentos **existentes** (Felix Cell, Bistrô 56, etc.) **não são alterados** — nenhum script de update massivo é executado.
- [ ] A função `getInternalConfig` retorna `version: 1` como fallback seguro quando o documento mais recente de `bot_configurations` não tem o campo `version` (proteção para registros legados).

### Coleção `publish_history` (nova)
- [ ] A coleção `publish_history` é criada implicitamente na primeira inserção (comportamento padrão do MongoDB — sem comando `db.createCollection` explícito necessário).
- [ ] Schema de cada documento: `{ tenant_id: String, version: Number, published_by: String, published_at: Date, status: String }`.
- [ ] Índices criados via `createIndexes()`: `{ tenant_id: 1 }` e `{ published_at: -1 }` — confirmado nos logs de startup.
- [ ] O `_test-tenant` tem pelo menos 1 registro em `publish_history` após o fluxo de `POST /publish` ser chamado uma vez no ambiente de teste.

### Isolamento (Regra #1 — Zero Downtime)
- [ ] A criação dos índices de `publish_history` ocorre dentro da função `createIndexes()` já existente, que roda no boot do servidor — não impede mensagens em trânsito.
- [ ] Nenhuma operação desta story usa `db.collection.drop()`, `updateMany` em escopo global sem filtro, ou qualquer operação destrutiva sobre coleções existentes.

### Validação no Atlas
- [ ] No MongoDB Atlas, confirmar visualmente (ou via query) que:
  - `publish_history` existe.
  - Índices `tenant_id_1` e `published_at_-1` aparecem na aba Indexes da coleção.
  - `bot_configurations` da Felix Cell **não foi alterada** (campo `version` ausente nos documentos antigos é esperado).

## Definição de Pronto (DoD)

- [ ] Índices de `publish_history` visíveis no Atlas.
- [ ] `getInternalConfig` retorna `version: 1` para tenant com `bot_configurations` sem campo `version`.
- [ ] Após `POST /publish` no `_test-tenant`, registro aparece em `publish_history`.
- [ ] Query manual confirma que Felix Cell não foi afetada.

## Dependências

- **Bloqueia:** Story 1.4 (Testes dependem de `publish_history` existir)
- **Bloqueada por:** Nenhuma
- **Paralela a:** Story 1.2 (Endpoints)

## Referências

- [system-design-kairos-engine-internal-api.md](../architecture/system-design-kairos-engine-internal-api.md) — Seção 4 (Modelo de Dados incremental)
- [ADR-004](../architecture/adr/ADR-004-arquitetura-definitiva-experia-ai-agents.md) — Action Item 3 e Restrição #5
- Arquivo existente: `src/services/manager-db.js` (funções já implementadas)
