# ADR-004: Arquitetura Definitiva — Mission Control (Control Plane) sobre KAIROS Engine (Runtime)

**Status:** Accepted
**Date:** 2026-07-13
**Deciders:** Gabriel (Experia Solutions), Felix (Felix Cell, tenant piloto)
**Consolida:** ADR-001 (squad task-first, Felix Cell), ADR-002 (partes ainda válidas — multi-tenant, roadmap A–F, 7 tools do MCP server), ADR-003 (correção de escopo — supersede as partes rejeitadas do ADR-002)
**Repos de referência:** [`agents-lab-experia`](https://github.com/DaRkVIlE/agents-lab-experia) (Mission Control) · [`my_ai_agents`](https://github.com/DaRkVIlE/my_ai_agents) (KAIROS Engine — runtime de produção)

---

## Context

O projeto Experia AI Agents passou por três decisões sucessivas que, juntas, definem a arquitetura atual:

1. **ADR-001** estabeleceu, para a squad task-first da Felix Cell, a separação entre regra de negócio como dado (`config/*.yaml`) e comportamento (`tasks/*.md`), evitando lógica hardcoded.
2. **ADR-002** propôs o `agents-lab-experia` (LibreChat) como camada de calibração, desenhou o `experia-calibration-mcp-server` com 7 tools, e definiu isolamento multi-tenant (contas `USER` por cliente, `X-Tenant-Key` por binding MCP). Partiu, porém, de um diagnóstico incorreto sobre `my_ai_agents` — tratou-o como serviço satelital descartável, a ser absorvido e desativado.
3. **ADR-003** corrigiu esse diagnóstico: `my_ai_agents` (rebatizado "KAIROS Engine") é o runtime de produção multi-tenant já no ar — Evolution API (WhatsApp), Redis (fila/sessão), Postgres (dado transacional) e MongoDB (config/perfil por tenant). Não é descartável nem migrável. Ao mesmo tempo, registrou a mudança de escopo do produto: de "calibrar um agente" para "Mission Control multi-tenant", onde cada gestor Experia (Felix Cell, Bistrô 56, Letícia D, Ateliê Dhecor etc.) ganha um cockpit próprio de controle sobre a própria equipe digital.

Este ADR consolida as três decisões num único documento de referência, removendo o que foi rejeitado (Option A do ADR-003 / item 2 do Decision original do ADR-002) e mantendo tudo que segue válido, para que não haja mais necessidade de ler três ADRs em sequência para entender o estado atual da arquitetura.

## Decision

1. **KAIROS Engine (`my_ai_agents`) é o único runtime de produção.** Dono de: envio/recebimento real de WhatsApp (Evolution API), fila e estado de conversa (Redis/`ioredis`), dado transacional por tenant (Postgres/`pg`), config/perfil por tenant (MongoDB — `manager_profiles`, `bot_configurations`). Nenhuma migração desses componentes para o LibreChat.
2. **Mission Control (`agents-lab-experia`, LibreChat) é o control plane multi-tenant.** Dá a cada gestor uma superfície de calibração, teste e supervisão sobre a própria equipe digital, sem expor a complexidade do KAIROS Engine.
3. **Integração exclusivamente por contrato de API/MCP.** O `experia-calibration-mcp-server` fala com o KAIROS Engine existente; nunca há migração ou duplicação de banco.
4. **API interna do KAIROS Engine, versionada, é o caminho de integração recomendado** — não leitura/escrita direta no Mongo/Postgres internos (ver Trade-off Analysis e Action Item 1).
5. **`calibration_publish_agent` grava na config do tenant dentro do KAIROS Engine**, via essa API interna — o KAIROS Engine já sabe falar com o Evolution API, então não há mais hop n8n intermediário só para publicação.
6. **Modelo de dados da squad task-first (ADR-001) permanece válido** — `config/*.yaml` + `tasks/*.md` — mas compila para o formato de prompt que o KAIROS Engine já consome por tenant, não para um `agent.yaml` do LibreChat.
7. **Isolamento multi-tenant (ADR-002) permanece o modelo de acesso do Mission Control** — contas `USER` por cliente, `X-Tenant-Key` por binding MCP — só muda o alvo final de escrita.
8. **As 7 tools do `experia-calibration-mcp-server` (RP-002, Seção 9) permanecem a interface do Mission Control**, com alvo corrigido (Action Item 2 abaixo).
9. **Roadmap A–F do ADR-002 permanece válido**, exceto os itens de migração de dados para o Mongo do LibreChat (removidos — Action Item 4).

### Arquitetura

```
┌───────────────────────────────┐        ┌─────────────────────────────────────┐
│  agents-lab-experia (LibreChat)│        │   my_ai_agents = KAIROS ENGINE       │
│       = MISSION CONTROL        │        │   (runtime de produção, já no ar)    │
│                                 │        │                                       │
│  Agent 🎛️ Calibração (/tenant) │        │  Express + Evolution API (WhatsApp)  │
│      │                         │        │  Redis (ioredis) — fila/sessão       │
│      │ chama tools (7)         │        │  Postgres (pg) — dado transacional   │
│      ▼                         │        │  MongoDB — config/perfil por tenant  │
│  experia-calibration-mcp-server│──R/W──▶│  API interna versionada              │
│  (X-Tenant-Key por binding)    │        │  (manager_profiles, bot_configs)     │
└───────────────────────────────┘        └───────────────┬───────────────────────┘
                                                            │ já resolvido
                                                            ▼
                                              Evolution API → WhatsApp real do cliente
```

O LibreChat pode manter opcionalmente um Agent "espelho" por tenant para preview de tom em sandbox — nunca é ele que atende o cliente final.

## Options Considered

### Option A: Absorver `my_ai_agents` no LibreChat (ADR-002 original) — Rejeitada
| Dimensão | Avaliação |
|---|---|
| Risco à operação | Alto — migração de Evolution API/Redis/Postgres sem downtime do bot em produção |
| Esforço | Alto — reconstrução de peça que já funciona |
| Ganho real | Nenhum — o problema nunca foi o runtime, foi a ausência de painel de calibração |

### Option B: Mission Control como control plane sobre o KAIROS Engine existente — **Aceita**
| Dimensão | Avaliação |
|---|---|
| Risco à operação | Baixo — núcleo do KAIROS Engine intocado, só ganha superfície de API/MCP |
| Esforço | Médio — exige MCP server + API interna no KAIROS Engine, mas sobre schema já existente |
| Ganho para o produto | Alto — entrega controle multi-tenant sem expor JSON nem dependência da Experia por ajuste |
| Alinhamento arquitetural | Mantém a separação runtime vs control plane já usada em ADR-001 (persona vs dado) |

### Option C: Duas plataformas paralelas desconectadas — Rejeitada
| Dimensão | Avaliação |
|---|---|
| Risco à operação | Nenhum |
| Esforço | Baixo no curto prazo |
| Ganho para o produto | Nulo — não entrega o cockpit multi-tenant que motivou a mudança de escopo |

## Trade-off Analysis

A fronteira certa é entre **controle** (Mission Control) e **execução** (KAIROS Engine) — não uma disputa por qual sistema sobrevive. Colocar o KAIROS Engine como fonte de verdade do dado de runtime é consistente com o princípio já usado no ADR-001 (regra de negócio como dado) e no ADR-002 (capability MCP reusável): o Mission Control não precisa possuir o dado do tenant, precisa de uma API bem desenhada na frente dele.

Isso também reduz a superfície do risco crítico já identificado — vazamento cross-tenant: existe um único lugar onde o dado de produção mora, e `X-Tenant-Key` continua sendo o único portão de entrada, agora apontando para o KAIROS Engine.

Resta uma decisão em aberto de implementação (não de arquitetura): **API interna nova e versionada** vs. **leitura/escrita direta no Mongo/Postgres do KAIROS Engine**. A primeira custa uma sprint extra; a segunda acopla o schema interno do runtime a um consumidor externo, quebrando o Mission Control silenciosamente em qualquer mudança de schema. Este ADR recomenda a API interna (ver Action Item 1).

## Consequences

- **Fica mais fácil:** nenhuma migração de dado de produção; bot da Felix Cell segue no ar durante toda a transição; esforço de engenharia concentrado numa única frente nova (expor/consumir API do KAIROS Engine via MCP).
- **Fica mais difícil (novo):** KAIROS Engine precisa ganhar uma superfície de API pensada para consumo por um MCP server multi-tenant externo — trabalho que o ADR-002 original não previa.
- **Vai precisar revisitar:** desenho das 7 tools do `experia-calibration-mcp-server` (RP-002, Seção 9), especialmente `calibration_publish_agent` (novo alvo) e `calibration_get_status`/`calibration_list_tenants` (status real de execução — fila Redis, última mensagem processada — não só status de publicação).
- **Risco a monitorar:** se o MCP server acabar escrevendo direto no banco do KAIROS Engine em vez de via API própria, qualquer mudança de schema quebra o Mission Control silenciosamente.

## Action Items

1. [ ] **Decisão de integração (bloqueante, antes de qualquer código novo).** API interna versionada no KAIROS Engine (`GET/PUT /internal/tenants/:id/config`, `POST /internal/tenants/:id/publish`) — recomendação deste ADR — vs. acesso direto ao Mongo/Postgres.
2. [ ] **Revisar as 7 tools do `experia-calibration-mcp-server`** contra o alvo correto (KAIROS Engine, não LibreChat).
3. [ ] **Confirmar `manager_profiles`/`bot_configurations` existentes como fonte de verdade** — sem recriação em outro lugar.
4. [ ] **Remover definitivamente** qualquer referência residual, em backlog ou documentação, a "migrar collections do Atlas para o Mongo do LibreChat" ou "`my_ai_agents` deixa de existir como serviço".
5. [ ] **Critério de aceite da Sprint B:** cada gestor logado no Mission Control vê e calibra apenas a própria equipe digital (agentes do próprio tenant no KAIROS Engine).
6. [ ] **Manter roadmap A–F do ADR-002** (multi-tenant/Sprint B, squad task-first/Sprint C via ADR-001, demo pública/Sprint F), ajustando só os pontos de integração conforme itens 1–4.
