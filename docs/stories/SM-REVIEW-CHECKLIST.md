# Checklist de Revisão de Stories — @sm

**Aplicado em:** Sprint A + Sprint B — API Interna KAIROS Engine  
**Checklist:** story-draft-checklist.md (AIOX Framework)  
**Revisado por:** @sm (River)  
**Data:** 2026-07-15

---

## Resultado por Story

| Story | Título | Tem Story Statement | Critérios de Aceite Rastreáveis | Referencia Artefato-Fonte | DoD Definido | Dependências Explícitas | Cross-Repo Sinalizado | Status @sm |
|---|---|---|---|---|---|---|---|---|
| 1.1 | `_test-tenant` | ✅ | ✅ | ✅ | ✅ | ✅ Bloqueia 1.2, 1.4 | N/A | ✅ APROVADA |
| 1.2 | Endpoints `/internal/v1` | ✅ | ✅ | ✅ | ✅ | ✅ Dep. 1.1 / Paralela 1.3 | N/A | ✅ APROVADA |
| 1.3 | Schema MongoDB | ✅ | ✅ | ✅ | ✅ | ✅ Paralela 1.2 | N/A | ✅ APROVADA |
| 1.4 | Suite de Testes | ✅ | ✅ | ✅ `test-strategy` como fonte de verdade | ✅ | ✅ Dep. 1.1, 1.2, 1.3 | N/A | ✅ APROVADA |
| 1.5 | MCP Server Cross-Repo | ✅ | ✅ | ✅ | ✅ | ✅ Dep. 1.2 | ✅ ⚠️ Explícito | ✅ APROVADA |
| 1.6 | Contract Tests | ✅ | ✅ | ✅ | ✅ Com fallback PENDING | ✅ Dep. 1.2, 1.4, 1.5 | ✅ ⚠️ Explícito | ✅ APROVADA |

---

## Validação das Regras Não-Negociáveis (ADR-004)

| Regra | Validada nas Stories | Onde |
|---|---|---|
| #1 Zero Downtime | ✅ | 1.1, 1.2, 1.3 — critérios proíbem operações destrutivas |
| #2 Zero acesso externo ao BD | ✅ | 1.5 DoD — "@sm valida que nenhuma tool acessa Mongo diretamente" |
| #3 Autenticação dupla em toda rota | ✅ | 1.2 — critérios de aceite de auth cobrem todos os 5 endpoints |
| #4 Nunca testar contra tenant real | ✅ | 1.1, 1.4 — `_test-tenant` bloqueante, E2E restringe ao tenant de teste |
| #5 `manager_profiles`/`bot_configurations` como fonte de verdade | ✅ | 1.3 — "documentos existentes não são alterados" |
| #6 Versionamento desde dia 1 | ✅ | 1.2 — prefixo `/internal/v1` obrigatório; 1.6 — contrato versionado |

---

## Dependências Cross-Repo (sinalização explícita conforme handoff)

- **Story 1.5** → trabalho em `experia-calibration-mcp-server` — dependente de 1.2
- **Story 1.6** → trabalho em ambos os repos — com fallback PENDING documentado se cross-repo não for possível nesta sprint

---

## Próximos Passos após Aprovação de Gabriel

1. @dev assume Story **1.1** (sem dependências — começa já)
2. @dev assume Story **1.3** (paralela — pode rodar com 1.1)
3. @dev assume Story **1.2** após 1.1 estar concluída
4. @qa audita cobertura da Story **1.4** após 1.2 + 1.3 concluídas
5. Stories **1.5** e **1.6** entram em Sprint B após Sprint A validada

---

*— River, removendo obstáculos 🌊*
