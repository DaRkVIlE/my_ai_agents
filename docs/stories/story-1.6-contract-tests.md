# Story 1.6 — Contract Tests (MCP Server ↔ KAIROS Engine)

**Status:** Draft  
**Sprint:** Sprint B — Integração Cross-Repo  
**Repositórios:** `my_ai_agents` + `experia-calibration-mcp-server` (ambos)  
**Criado por:** @sm (River)  
**Referência de Arquitetura:** ADR-004 (Action Item 6) · `test-strategy-kairos-engine-internal-api.md` (Seção "Contract Tests")  
**Restrições-Mãe:** #6 (Versionamento — contrato compartilhado é a garantia)

---

## ⚠️ Aviso de Dependência Cross-Repo

> Esta story envolve **dois repositórios** (`my_ai_agents` e `experia-calibration-mcp-server`). O artefato de contrato (schema JSON) deve existir em local acessível por ambos. Se o KAIROS não tiver visibilidade do segundo repositório, gerar o contrato como arquivo publicável e sinalizar a dependência explicitamente.

## Contexto

O risco central identificado no ADR-004 é: "mudança de schema quebra o Mission Control silenciosamente". Contract tests são a única forma automatizada de garantir que isso não aconteça. Eles funcionam fixando o schema de request/response de cada endpoint e rodando a validação nos dois lados da integração a cada commit.

## Story

**Como** engenheiro de qualidade (Experia),  
**Quero** contract tests que validem o schema de todos os 5 endpoints de `/internal/v1` contra as 7 tools do MCP server,  
**Para que** qualquer mudança incompatível em qualquer lado quebre o CI antes de chegar em produção — nunca silenciosamente.

## O que São Contract Tests neste Contexto

Um **contrato** é um arquivo JSON Schema fixando exatamente o que cada endpoint aceita e retorna. Ele é gerado uma vez e versionado junto com `/internal/v1`. Quando qualquer lado muda, o schema falha a validação.

```
contracts/
  v1/
    get-config.json          # Schema de response do GET /config
    put-config-request.json  # Schema de request do PUT /config
    put-config-response.json # Schema de response do PUT /config
    post-publish-request.json
    post-publish-response.json
    get-status-response.json
    get-tenants-response.json
```

## Critérios de Aceite

### Artefatos de Contrato
- [ ] Pasta `contracts/v1/` criada em `my_ai_agents` com um arquivo JSON Schema para cada request/response dos 5 endpoints.
- [ ] Os schemas cobrem **todos os campos usados pelas 7 tools** do MCP server (não apenas os campos que a API retorna — os que o consumidor realmente lê).
- [ ] Schemas são versionados junto com o código — qualquer mudança de campo obrigatório exige criar `contracts/v2/` e manter `v1/` até migração completa do MCP server.

### Testes no lado `my_ai_agents`
- [ ] Arquivo `tests/contract/api-contract.test.js` que:
  - [ ] Faz chamadas reais (ou com mocks) para cada endpoint.
  - [ ] Valida o response contra o JSON Schema correspondente em `contracts/v1/`.
  - [ ] Falha se qualquer campo obrigatório estiver ausente ou com tipo errado.
- [ ] Roda em `npm test` sem configuração extra.

### Testes no lado `experia-calibration-mcp-server`
- [ ] Arquivo `tests/contract/mcp-contract.test.ts` que:
  - [ ] Para cada tool, constrói o payload que seria enviado à API e valida contra o JSON Schema de request em `contracts/v1/`.
  - [ ] Para cada tool, valida que o response da API (mockado com o schema) é corretamente parseado pela tool.
- [ ] Se o repositório do MCP server não estiver acessível no mesmo workspace: gerar os schemas em `contracts/v1/` e documentar em `story-1.6-PENDING.md` que o time do MCP server deve adotar o mesmo arquivo de contrato.

### CI Gate
- [ ] Quando `contracts/v1/` for alterado sem criar `v2/`, o teste falha com mensagem: `"BREAKING CHANGE: contract v1 modified without versioning. Create contracts/v2/ or revert."` *(implementação simplificada: hash do diretório comparado no CI — instrução para sprint futura se CI não existir ainda).*

## Definição de Pronto (DoD)

- [ ] `contracts/v1/` com todos os schemas gerados.
- [ ] `tests/contract/api-contract.test.js` passando em `my_ai_agents`.
- [ ] Se cross-repo possível: `tests/contract/mcp-contract.test.ts` passando em `experia-calibration-mcp-server`.
- [ ] Se cross-repo **não** possível nesta sprint: `story-1.6-PENDING.md` documentando a dependência explicitamente (não silenciosamente ignorada — conforme requisito do handoff original).
- [ ] @qa confirmou que os schemas cobrem todos os campos que as 7 tools efetivamente leem.

## Dependências

- **Bloqueada por:** Story 1.2 (Endpoints), Story 1.4 (Testes), Story 1.5 (MCP Server)
- **Bloqueia:** Nenhuma (é o último item da cadeia)
- **Cross-repo:** `experia-calibration-mcp-server`

## Referências

- [test-strategy-kairos-engine-internal-api.md](../architecture/test-strategy-kairos-engine-internal-api.md) — Seção "Contract Tests (API ↔ MCP server)" e "Metas de Cobertura"
- [api-docs-kairos-engine-internal-v1.md](../architecture/api-docs-kairos-engine-internal-v1.md) — Schemas de referência
- [ADR-004](../architecture/adr/ADR-004-arquitetura-definitiva-experia-ai-agents.md) — Action Item 6 e Risco "mudança silenciosa de schema"
