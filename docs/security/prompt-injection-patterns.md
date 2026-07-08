# Padrões de Injeção de Prompt (Heurísticas)

Este documento lista os padrões e heurísticas de detecção de injeção de prompt verificados no endpoint de calibração de bots (`commercial-ai-bots`).

## Objetivo
A camada de sanitização e verificação visa evitar que o conteúdo gerado por um LLM no painel de onboarding do LibreChat comprometa o *system prompt* real do agente de atendimento que roda em produção.

A detecção atual é feita via heurísticas simples (regex/substring), buscando termos frequentemente usados em ataques de *jailbreak* e *prompt injection*.

## Padrões Atualmente Verificados

Qualquer campo de regra de negócio (`business_rules`) ou exemplos (`examples`) que contenha (case-insensitive) os seguintes padrões será rejeitado e a calibração será definida como `status = 'rejected'`:

1. `ignore as instruções anteriores`
2. `ignore previous instructions`
3. `você agora é`
4. `you are now`
5. `system:`
6. `assistant:`
7. `desconsidere tudo`
8. `novo prompt`

## Ação Pós-Detecção
- A calibração (versão) é salva no banco, mas recebe o status `rejected`.
- Uma entrada é gerada no log de auditoria (`audit_log`) com o `action = 'reject_version_injection'`, associando a rejeição à versão.
- A API retorna HTTP 400 avisando o chamador.
- **Nenhum alerta silencioso:** A configuração rejeitada não afeta a versão atualmente `active`.

## Como Expandir
Para adicionar novos padrões de heurística, edite a função `containsPromptInjection(text)` em `src/routes/internal-manager.js` do projeto `commercial-ai-bots`.
