# System Design: API Interna do KAIROS Engine (`my_ai_agents`) para o Mission Control

**Referência:** ADR-004, Action Item 1 (bloqueante)
**Objetivo:** desenhar a superfície de API que o `experia-calibration-mcp-server` vai consumir para ler/escrever config de tenant e status de execução no KAIROS Engine, sem acoplar o Mission Control ao schema interno (Mongo/Postgres) do runtime.

---

## 1. Requisitos

### Funcionais
- **Ler** config atual de um tenant (`manager_profiles` + `bot_configurations`).
- **Escrever/publicar** uma nova config de tenant, ativando-a no bot real (Evolution API já sabe consumir essa config — o endpoint só precisa persistir e sinalizar).
- **Consultar status real de execução**: profundidade da fila Redis, última mensagem processada, conexão da sessão Evolution API, versão/timestamp da última publicação.
- **Listar tenants** acessíveis a um binding MCP (uso administrativo/introspecção, não por gestor comum).

### Não-funcionais
- **Zero downtime**: o bot da Felix Cell (e demais tenants) não pode cair durante escrita de config nem durante deploy da própria API.
- **Isolamento cross-tenant é o requisito de segurança mais crítico** (já identificado no ADR-003) — nenhuma rota pode vazar dado de um tenant para outro, mesmo em caso de erro de implementação no MCP server.
- **Latência não é crítica** — calibração é um fluxo humano (gestor ajustando tom/regras), não um caminho de atendimento em tempo real. Segundos de propagação são aceitáveis.
- **Versionamento desde o dia 1** — é a cláusula de escape para não repetir o erro do ADR-002 (acoplar um consumidor externo a algo que muda sem contrato).

### Restrições
- Stack existente: Express + MongoDB (config) + Postgres (transacional) + Redis/`ioredis` (fila) + Evolution API — nada disso muda de lugar.
- Time pequeno (Gabriel + Felix como piloto) — a API precisa ser mínima e fácil de manter, não um framework novo.
- O MCP server (`experia-calibration-mcp-server`) já existe desenhado com 7 tools e autenticação por `X-Tenant-Key` por binding — a API interna precisa encaixar nesse contrato, não redesenhá-lo.

## 2. Desenho de Alto Nível

```
Gestor (Mission Control / LibreChat)
        │
        ▼
Agent 🎛️ Calibração ──chama tool──▶ experia-calibration-mcp-server
                                        │  (valida X-Tenant-Key do binding
                                        │   → resolve tenantId permitido)
                                        │
                                        │  Authorization: Bearer <service-token>
                                        │  X-Tenant-Scope: <tenantId assinado>
                                        ▼
                        ┌───────────────────────────────────┐
                        │   KAIROS Engine — /internal/v1     │
                        │   (novo módulo dentro de           │
                        │    my_ai_agents, Express)          │
                        │                                     │
                        │   • valida escopo de tenant         │
                        │     de novo (defesa em profundidade)│
                        │   • fala com Mongo/Postgres/Redis   │
                        │     internamente — nunca expõe      │
                        │     schema bruto para fora          │
                        └───────────────┬─────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
              MongoDB              Postgres              Redis
       (bot_configurations,   (histórico OS,        (fila/sessão,
        manager_profiles,      dado transacional)     via ioredis)
        publish_history — novo)
                    │
                    ▼
             Evolution API → WhatsApp real do cliente
```

**Decisão de design central:** a API interna faz *dupla validação* de tenant — o MCP server já filtra por `X-Tenant-Key`, mas a API do KAIROS Engine não confia cegamente no `tenantId` que chega na URL; ela exige um token de escopo assinado pelo MCP server (curto prazo, ex. 60s) contendo o `tenantId` autorizado. Isso fecha o requisito de segurança #1 do projeto com duas camadas independentes em vez de uma.

## 3. Deep Dive — Contrato de API

Prefixo: `/internal/v1` (versionado explicitamente desde o início — resolve o risco de quebra silenciosa apontado no ADR-004).

### `GET /internal/v1/tenants/:tenantId/config`
Retorna a config atual, lida diretamente de `manager_profiles` + `bot_configurations`.

```json
{
  "tenant_id": "felix-cell",
  "version": 14,
  "profile": { "business_name": "Felix Cell", "tone": "...", "rules": [...] },
  "bot_config": { "channels": ["whatsapp"], "active": true },
  "updated_at": "2026-07-10T14:32:00Z",
  "updated_by": "gestor:felix"
}
```
- `version` é obrigatório na resposta — usado para concorrência otimista no `PUT`.

### `PUT /internal/v1/tenants/:tenantId/config`
Grava um **draft** (não publica ainda — separação intencional de "salvar" e "ir ao ar", para permitir preview no Agent-espelho do LibreChat antes de publicar).

Request:
```json
{ "expected_version": 14, "profile": {...}, "bot_config": {...} }
```
- `409 Conflict` se `expected_version` não bater com o atual (outro gestor ou processo já mudou a config) — evita write silencioso perdido.
- `422` em validação de schema (regras de negócio, campos obrigatórios).

### `POST /internal/v1/tenants/:tenantId/publish`
Ativa a última config salva (draft ou a enviada no corpo) como a que o bot usa de fato. O KAIROS Engine já sabe propagar para o Evolution API — este endpoint só formaliza "isso agora é produção" e registra em `publish_history`.

```json
{ "version": 15, "published_at": "2026-07-13T18:00:00Z", "status": "live" }
```
- Grava em nova coleção `publish_history` (tenant_id, version, quem publicou, timestamp) — é o registro de auditoria que hoje não existe e que o MCP server vai precisar para `calibration_get_status`.

### `GET /internal/v1/tenants/:tenantId/status`
Status real de execução — não status de publicação.
```json
{
  "tenant_id": "felix-cell",
  "evolution_session": "connected",
  "queue_depth": 2,
  "last_message_processed_at": "2026-07-13T18:04:11Z",
  "last_published_version": 15
}
```
- Se Redis ou Evolution API estiverem indisponíveis, retorna `200` com campos parciais + `"degraded": true` em vez de falhar — o gestor precisa ver "o bot está com problema" no Mission Control, não um erro genérico de API.

### `GET /internal/v1/tenants`
Uso restrito a um escopo administrativo (não por gestor comum) — lista tenants existentes, para introspecção/debug do próprio Mission Control. Protegido por um nível de credencial diferente do `X-Tenant-Scope` de tenant único.

## 4. Modelo de Dados (incremental, não substitui nada existente)

- `manager_profiles`, `bot_configurations` — **inalteradas**, continuam sendo a fonte de verdade (ADR-003/004, Action Item 3).
- **Nova:** `publish_history` — `{ tenant_id, version, published_by, published_at, status }`. É o único dado novo que este design introduz; tudo mais é leitura/escrita do que já existe.
- `version` como campo incremental em `bot_configurations` — se ainda não existir, é o único ajuste de schema necessário no que já existe (não é uma migração, é um campo adicional com default `1`).

## 5. Erros e Retry

| Situação | Resposta | Comportamento esperado no MCP server |
|---|---|---|
| Token de escopo inválido/expirado | `401` | Reemitir token, não expor detalhe ao gestor |
| `tenantId` fora do escopo do token | `403` | Log de segurança — isso não deveria acontecer nunca; alertar |
| `expected_version` desatualizado | `409` | Buscar config atual, pedir ao gestor para revisar antes de tentar de novo |
| Validação de schema | `422` | Mostrar erro de campo específico no chat |
| Mongo/Postgres indisponível | `503` | Retry com backoff exponencial (3 tentativas); se persistir, informar indisponibilidade temporária |
| Redis/Evolution indisponível (só afeta `status`) | `200` com `degraded: true` | Mostrar aviso, não bloquear o restante do fluxo |

## 6. Escala e Confiabilidade

- Volume esperado é baixo (poucos tenants piloto, eventos de calibração são humanos, não tráfego de mensagens) — **não há necessidade de cache agressivo ou fila para esta API** no estágio atual.
- Ponto único real de risco de disponibilidade: se o módulo `/internal/v1` cair, ele **não deve derrubar o core do bot** (recebimento/envio via Evolution API) — precisa rodar no mesmo processo Express mas sem bloquear o event loop com operações longas; nenhuma operação aqui deve ser síncrona-bloqueante em relação ao caminho de mensagens do bot.
- Quando o número de tenants crescer além do piloto, revisitar: rate limit por `tenantId` no MCP server, e possível cache de `GET /config` com TTL curto (10–30s) se o Mission Control passar a fazer polling de status.

## 7. Trade-offs

| Alternativa | Por que não |
|---|---|
| MCP server lê/escreve direto no Mongo/Postgres do KAIROS Engine | Mais rápido de implementar agora, mas acopla o Mission Control ao schema interno — qualquer mudança de schema quebra silenciosamente (risco já sinalizado no ADR-004) |
| Uma única credencial de serviço sem escopo por tenant | Mais simples, mas remove a segunda camada de defesa contra vazamento cross-tenant — não aceitável dado que esse é o risco #1 do projeto |
| Publicar direto no `PUT` (sem separar draft/publish) | Mais simples, mas remove a possibilidade de preview no Agent-espelho antes de ir ao ar — o Mission Control perderia a função de "testar antes de publicar" que motivou a mudança de escopo |

## 8. O que revisitar quando o sistema crescer

- Se o número de tenants ou a frequência de calibração aumentar muito, avaliar cache de leitura e/ou webhook (KAIROS Engine notifica o Mission Control em vez de polling).
- Se surgir necessidade de mais de um nível de permissão por tenant (ex.: gestor vs. funcionário), o token de escopo precisa carregar `role`, não só `tenantId`.
- `publish_history` pode crescer para uma trilha de auditoria mais completa (diff de config, não só versão) se isso virar requisito de compliance do cliente.

## 9. Próximo passo sugerido

Com este contrato definido, o próximo bloqueio é decidir a forma exata do token de escopo (JWT assinado vs. token opaco validado por lookup) — isso é um detalhe de implementação, não de arquitetura, e pode ser resolvido no próprio código. A partir daqui, os Action Items 2 e 3 do ADR-004 (revisar as 7 tools do MCP server contra este contrato, confirmar `manager_profiles`/`bot_configurations` como fonte de verdade) já podem ser executados em paralelo.
