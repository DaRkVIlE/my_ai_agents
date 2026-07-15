# Story 1.1 — Criar Ambiente de Teste Isolado (`_test-tenant`)

**Status:** Draft  
**Sprint:** Sprint A — Fundação da API Interna  
**Repositório:** `my_ai_agents`  
**Criado por:** @sm (River)  
**Referência de Arquitetura:** ADR-004 · `test-strategy-kairos-engine-internal-api.md` (Seção: Estratégia de Segurança Operacional)  
**Restrição-Mãe:** Regra não-negociável #4 — "Nunca testar contra tenant real"

---

## Contexto

Nenhum teste de integração, security boundary ou E2E pode ser executado antes que exista um tenant de teste verdadeiramente isolado — sem associação a clientes reais, com sua própria sessão na Evolution API. Este é o **bloqueante absoluto** antes das Stories 1.2, 1.4.

## Story

**Como** @dev implementando e @qa validando a API interna `/internal/v1`,  
**Quero** um `_test-tenant` completamente isolado no ecossistema KAIROS Engine,  
**Para que** eu possa rodar testes de integração, security boundary e E2E sem nenhum risco ao bot da Felix Cell ou qualquer outro cliente ativo em produção.

## Critérios de Aceite

- [ ] Existe um documento `_test-tenant.md` em `docs/` descrevendo as credenciais, o número WhatsApp de teste e o `instanceName` da Evolution API associados ao `_test-tenant`.
- [ ] O `_test-tenant` tem um registro em `manager_profiles` no MongoDB com `manager_id: "_test-tenant"` e campo `test: true` para distingui-lo de tenants reais.
- [ ] O `_test-tenant` tem uma sessão criada na Evolution API apontando para um número de WhatsApp dedicado a testes (não pertencente a nenhum cliente atual).
- [ ] Uma variável de ambiente `TEST_TENANT_ID=_test-tenant` é documentada no `.env.example`.
- [ ] É impossível, por configuração ou guarda de código, que os scripts de E2E sejam executados contra outro `tenant_id` que não o `_test-tenant`.
- [ ] O `_test-tenant` **não aparece** no endpoint `GET /internal/v1/tenants` em produção (filtragem por `test: true`).

## Restrições da Regra não-negociável #1 (Zero Downtime)

- A criação do `_test-tenant` no MongoDB Atlas **não pode usar** nenhuma operação que bloqueie escrita nas coleções `manager_profiles` ou `bot_configurations` enquanto o bot da Felix Cell estiver ativo.
- Inserção deve ser via `insertOne` simples com novo `manager_id`, sem migrations globais.

## Definição de Pronto (DoD)

- [ ] `_test-tenant` inserido no MongoDB (validado por query).
- [ ] Sessão Evolution API ativa para o número de teste.
- [ ] `.env.example` atualizado.
- [ ] `docs/_test-tenant.md` criado e revisado por @sm.
- [ ] @qa confirmou que consegue chamar `GET /internal/v1/tenants/_test-tenant/config` e receber `200` (mesmo que com dados mínimos).

## Dependências

- **Bloqueia:** Story 1.2 (Endpoints), Story 1.4 (Testes)
- **Bloqueada por:** Nenhuma

## Referências

- [test-strategy-kairos-engine-internal-api.md](../architecture/test-strategy-kairos-engine-internal-api.md) — Seção "Estratégia de Segurança Operacional"
- [ADR-004](../architecture/adr/ADR-004-arquitetura-definitiva-experia-ai-agents.md) — Restrição #4
