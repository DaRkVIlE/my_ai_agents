# Test Strategy: API Interna do KAIROS Engine (`/internal/v1`)

**Referência:** ADR-004 · System Design (2026-07-13) · API Docs `/internal/v1`
**Restrição não-negociável:** nenhum teste, em nenhum ambiente, pode arriscar o bot da Felix Cell (ou qualquer outro tenant já em produção) parar de responder no WhatsApp real.

---

## Pirâmide de Testes Aplicada

```
              /  E2E (poucos)  \        MCP server real → API real → tenant de teste dedicado
             / Integração (média)\      API real ↔ Mongo/Postgres/Redis reais (ambiente isolado)
            /  Unit (muitos, rápidos) \ validação de escopo, versão, schema — sem I/O real
```

O grosso da confiança vem da base (unit) e do meio (integração contra dependências reais, mas em ambiente isolado do tenant de produção) — o topo (E2E contra produção) é deliberadamente mínimo, porque cada teste ali toca o sistema que já atende cliente real.

## Estratégia por Componente

### Lógica de negócio (unit)
Sem I/O — validação de escopo de tenant, concorrência de versão, validação de schema de config. Rápidos, muitos, rodam em todo commit.

### Camada HTTP / endpoints (integração)
API real subindo contra Mongo/Postgres/Redis **de um ambiente isolado** (não o banco de produção) — verifica que rotas, códigos de status e contratos batem com a doc.

### Contrato com o consumidor (contract tests)
O `experia-calibration-mcp-server` é o único consumidor desta API. Contract tests garantem que uma mudança em qualquer lado (API ou MCP server) quebra o teste antes de quebrar em produção — é a proteção direta contra o risco já sinalizado no ADR-004 ("mudança de schema quebra o Mission Control silenciosamente").

### Limites de segurança (security boundary tests)
Isolamento cross-tenant é o requisito #1 do projeto — merece sua própria categoria, não só "mais um caso de teste dentro de integração".

### Segurança operacional / produção (production-safety tests)
Categoria extra, específica deste sistema: testar contra um **tenant de teste dedicado**, nunca contra a Felix Cell ou qualquer cliente real, mesmo em "smoke test" pós-deploy.

## O que cobrir vs. o que pular

**Cobrir:** validação de escopo de tenant (todas as rotas), concorrência otimista de versão, publish idempotente, degradação graciosa do `/status`, todos os códigos de erro documentados, rate limit básico.

**Pular:** testes de carga/performance nesta fase (volume é baixo — calibração é evento humano, não tráfego de mensagens, conforme já registrado no system design); testes de UI do Mission Control (fora do escopo desta API); getters triviais.

## Casos de Teste por Endpoint

### `GET /config`
| Caso | Tipo | Esperado |
|---|---|---|
| Tenant existe, escopo correto | Integração | `200` com `version` presente |
| Tenant não existe | Integração | `404` |
| `X-Tenant-Scope` de outro tenant | Security | `403` — **não** vazar nenhum campo da config |
| `service-token` ausente | Unit/Integração | `401` |

### `PUT /config`
| Caso | Tipo | Esperado |
|---|---|---|
| `expected_version` correta | Integração | `200`, versão incrementa, draft salvo |
| `expected_version` desatualizada | Unit | `409` com config atual no corpo |
| Payload inválido (campo obrigatório faltando) | Unit | `422` com lista de campos |
| Escopo de tenant errado | Security | `403`, draft do tenant-alvo **não é alterado** |
| Duas escritas concorrentes na mesma versão | Integração | Uma vence (`200`), a outra recebe `409` — sem corrupção de dado |

### `POST /publish`
| Caso | Tipo | Esperado |
|---|---|---|
| Versão em draft é a mais recente | Integração | `200`, `publish_history` recebe novo registro |
| Versão informada não é a mais recente | Unit | `409` |
| Draft incompleto | Unit | `422` |
| Publicação não derruba sessão Evolution API ativa | **E2E, tenant de teste** | Sessão permanece `connected` antes/depois; nenhuma mensagem em trânsito é perdida |
| Escopo de tenant errado | Security | `403`, nenhuma publicação ocorre em nenhum tenant |

### `GET /status`
| Caso | Tipo | Esperado |
|---|---|---|
| Tudo saudável | Integração | `degraded: false`, todos os campos presentes |
| Redis fora do ar (simulado) | Integração | `200` (não `5xx`), `degraded: true`, `queue_depth: null` |
| Evolution API fora do ar (simulado) | Integração | `200`, `degraded: true`, `evolution_session: "unknown"` |
| Escopo de tenant errado | Security | `403` |

### `GET /tenants` (admin)
| Caso | Tipo | Esperado |
|---|---|---|
| Credencial `admin` válida | Integração | `200` com lista completa |
| Credencial de tenant comum (não-admin) tentando acessar | Security | `403` — este endpoint **nunca** aceita `X-Tenant-Scope` no lugar de credencial admin |

## Contract Tests (API ↔ MCP server)

- Schema de request/response de cada endpoint fixado em um contrato compartilhado (ex. JSON Schema versionado junto com `/internal/v1`).
- Roda nos dois repositórios (`my_ai_agents` e `agents-lab-experia`/MCP server) contra o mesmo arquivo de contrato — qualquer mudança que quebre o contrato falha o CI antes do merge, dos dois lados.
- Cobre especificamente os 5 endpoints e os 7 tools do MCP server que os consomem — é o item que resolve, em forma de teste automatizado, o Action Item 2 do ADR-004 ("revisar as 7 tools contra o alvo correto").

## Estratégia de Segurança Operacional (específica deste sistema)

1. **Nunca testar contra tenant real** — criar um `tenant_id` de teste dedicado (`_test-tenant`) com sessão Evolution API própria (número de teste, não o WhatsApp real de nenhum cliente), usado em integração e E2E.
2. **Smoke test pós-deploy** roda só contra `_test-tenant` — nunca contra Felix Cell ou qualquer tenant ativo, mesmo que seja "só um GET".
3. **Staging isolado** — Mongo/Postgres/Redis de teste, nunca compartilhados com produção, mesmo que isso signifique manter uma cópia menor da infra.
4. **Rollback testável**: como o `publish` já propaga para a sessão Evolution API ativa, o teste de rollback (publicar versão anterior) precisa ser validado no `_test-tenant` antes de qualquer publish real acontecer em produção pela primeira vez.

## Metas de Cobertura

| Camada | Meta |
|---|---|
| Unit (validação de escopo, versão, schema) | Alta (~90%+) — é lógica pura, barata de cobrir bem |
| Integração (rotas × Mongo/Postgres/Redis) | Todos os endpoints, todos os códigos de erro documentados |
| Security boundary | 100% dos endpoints testados com escopo de tenant incorreto |
| Contract | 100% dos campos usados pelas 7 tools do MCP server |
| E2E contra `_test-tenant` | Só os fluxos críticos: publish não derruba sessão; rollback funciona |

## Gaps Identificados

- **Não existe hoje um `_test-tenant` nem ambiente de staging isolado** — é pré-requisito antes de qualquer teste de integração/E2E, não algo a construir depois.
- **`publish_history` é uma coleção nova** — não há dado histórico para validar migrações; os testes de schema dela partem do zero, o que é uma vantagem (sem dívida de dado legado).
- **Chaos/infra testing** (queda simulada de Redis/Evolution) depende de conseguir simular indisponibilidade no ambiente de staging — se a infra de staging não replicar isso, os testes de `degraded: true` ficam limitados a mocks, o que é aceitável nesta fase mas deve ser revisitado se o `/status` virar dependência crítica de operação.
