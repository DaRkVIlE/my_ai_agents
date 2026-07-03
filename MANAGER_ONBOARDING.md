# Manager Onboarding System - Implementation Guide

## 🎯 Overview

Sistema de onboarding integrado ao LibreChat para gestores de negócio calibrarem seus bots IA em 5 passos simples:

1. **Tom de Voz** — Escolher personalidade do bot
2. **Serviços** — Listar serviços oferecidos
3. **Horários de Operação** — Quando o bot atende
4. **Regras de Reserva/Agendamento** — Políticas específicas
5. **Exemplos de Resposta** — Treinar com exemplos reais

## 📁 Estrutura de Arquivos

```
src/
├── services/
│   ├── manager-prompts.js        # System prompts dinâmicos
│   ├── manager-db.js             # MongoDB Atlas operations
│   └── librechat-manager.js       # Integração LibreChat
│
├── routes/
│   └── manager-api.js            # REST API endpoints
│
└── middlewares/
    └── manager-onboarding.js     # (próximo passo)
```

## 🚀 Quick Start

### 1. Variáveis de Ambiente

Adicione ao `.env`:

```bash
# MongoDB Atlas
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=commercial-ai-bots

# LibreChat (opcional, se integrado)
LIBRECHAT_API_KEY=your-api-key
LIBRECHAT_URL=http://localhost:3000
```

### 2. Integração no `src/index.js`

```javascript
// No topo do arquivo, adicione:
const managerApi = require('./routes/manager-api');
const { managerOnboardingMiddleware } = require('./services/librechat-manager');

// Após app.use(express.json()):
app.use('/api/manager', managerApi);

// Middleware global (opcional):
app.use(managerOnboardingMiddleware);
```

### 3. Instalar Dependência MongoDB

```bash
npm install mongodb
```

## 📊 Arquitetura de Dados

### Collections MongoDB

```javascript
// manager_profiles
{
  _id: ObjectId,
  manager_id: "uuid-1",
  username: "gestor_paulo",
  business_name: "Paulo Serviços",
  first_access: true,
  onboarding_completed: false,
  onboarding_step: 2,
  onboarding_responses: {
    tone: "casual",
    updated_at: Date
  },
  config: {
    tone: "consultivo",
    services: ["Consultoria", "Agendamento"],
    hours: {
      dias: "Segunda a Sexta",
      horario_inicio: "09:00",
      horario_fim: "18:00",
      fechamento: "Sábados e Domingos"
    },
    reservation_rules: "Prazo mínimo 24h",
    examples: [
      { customer: "Como funciona?", reply: "..." }
    ],
    bot_status: "active"
  },
  stats: {
    messages_sent: 1250,
    messages_received: 980,
    total_chats: 45
  },
  created_at: Date,
  updated_at: Date
}

// bot_configurations (histórico de versões)
{
  _id: ObjectId,
  manager_id: "uuid-1",
  version: 1,
  config: { ... },
  created_at: Date,
  status: "active" | "archived"
}

// onboarding_sessions
{
  _id: ObjectId,
  manager_id: "uuid-1",
  step_1: "casual",
  step_2: ["Consultoria"],
  step_3: { ... },
  step_4: "...",
  step_5: [ ... ],
  started_at: Date,
  updated_at: Date
}

// manager_audit_log
{
  _id: ObjectId,
  manager_id: "uuid-1",
  action: "onboarding_completed",
  details: { ... },
  timestamp: Date
}
```

## 🔄 Fluxo de Uso

### Primeira Vez (First Access)

```
1. Gestor acessa LibreChat
2. Sistema detecta first_access = true
3. Injeta: getManagerFirstAccessPrompt()
4. Mostra menu de 5 passos
5. Gestor responde cada passo
6. Sistema salva no MongoDB
7. Após step 5 → mostra resumo
8. Gestor confirma ou edita
9. Bot ativado! 🎉
```

### Calibração Contínua

```
1. Gestor retorna ao LibreChat
2. Sistema detecta onboarding_completed = true
3. Injeta: getManagerCalibratingPrompt()
4. Mostra painel de controle
5. Gestor pode:
   - editar tone / services / hours / regras
   - testar respostas
   - ativar/desativar bot
   - ver estatísticas
```

## 📡 API Endpoints

### POST `/api/manager/onboard`
Iniciar onboarding para novo gestor

```bash
curl -X POST http://localhost:8080/api/manager/onboard \
  -H "Content-Type: application/json" \
  -d '{
    "managerId": "uuid-1",
    "username": "paulo",
    "businessName": "Ateliê Dhecor"
  }'
```

**Response:**
```json
{
  "success": true,
  "isFirstAccess": true,
  "systemPrompt": "🎉 BEM-VINDO...",
  "manager": { ... }
}
```

### POST `/api/manager/onboarding/step`
Processar uma etapa do onboarding

```bash
curl -X POST http://localhost:8080/api/manager/onboarding/step \
  -H "Content-Type: application/json" \
  -d '{
    "managerId": "uuid-1",
    "step": 1,
    "input": "casual"
  }'
```

**Response:**
```json
{
  "success": true,
  "currentStep": 1,
  "nextStep": 2,
  "confirmation": "✅ Ótimo! Tom de voz: **Casual e Amigável**",
  "nextPrompt": "2️⃣ Serviços...",
  "isComplete": false
}
```

### POST `/api/manager/onboarding/complete`
Finalizar onboarding

```bash
curl -X POST http://localhost:8080/api/manager/onboarding/complete \
  -H "Content-Type: application/json" \
  -d '{
    "managerId": "uuid-1",
    "responses": {
      "tone": "casual",
      "services": ["Consultoria", "Agendamento"],
      "hours": { ... },
      "reserva_agendamento": "...",
      "examples": [ ... ]
    }
  }'
```

### GET `/api/manager/config?managerId=uuid-1`
Obter configuração do gestor

```bash
curl http://localhost:8080/api/manager/config?managerId=uuid-1
```

### PUT `/api/manager/config`
Atualizar campo específico

```bash
curl -X PUT http://localhost:8080/api/manager/config \
  -H "Content-Type: application/json" \
  -d '{
    "managerId": "uuid-1",
    "field": "tone",
    "value": "formal"
  }'
```

### POST `/api/manager/bot/activate`
Ativar bot para clientes

```bash
curl -X POST http://localhost:8080/api/manager/bot/activate \
  -H "Content-Type: application/json" \
  -d '{"managerId": "uuid-1"}'
```

### POST `/api/manager/bot/test`
Testar resposta do bot

```bash
curl -X POST http://localhost:8080/api/manager/bot/test \
  -H "Content-Type: application/json" \
  -d '{
    "managerId": "uuid-1",
    "question": "Qual é o preço?"
  }'
```

### GET `/api/manager/report?managerId=uuid-1`
Ver estatísticas e relatório

```bash
curl http://localhost:8080/api/manager/report?managerId=uuid-1
```

## 💬 LibreChat Integration

### System Prompt Injection

O middleware `managerOnboardingMiddleware` injeta automaticamente o system prompt correto baseado no estado do gestor:

```javascript
// Em src/index.js
app.use(managerOnboardingMiddleware);

// Então, ao processar mensagem:
const systemPrompt = req.systemPrompt;
// Passa para o LLM como primeira mensagem
```

### Fluxo de Mensagens

```
Gestor escreve mensagem
    ↓
LibreChat API recebe
    ↓
middleware verifica first_access
    ↓
Injeta system prompt correto
    ↓
LLM processa com contexto
    ↓
Resposta personalizada para gestor
```

## 🧪 Exemplo de Uso Completo

### Step 1: Primeira Mensagem
```
Gestor: "Oi, quero calibrar meu bot"

Sistema detecta: first_access = true
Sistema injeta: getManagerFirstAccessPrompt()

Resposta do Bot:
🎉 BEM-VINDO, PAULO!
Você está acessando o Painel de Calibração...
[menu com 6 opções]
```

### Step 2: Escolher Tone
```
Gestor: "1"

Sistema valida step 1
Sistema injeta passo 2

Resposta:
✅ Ótimo! Tom de voz: Formal e Profissional

2️⃣ SERVIÇOS
Quais são os principais serviços?
Digite: Consultoria, Agendamento, Suporte
```

### Step 3: Listar Serviços
```
Gestor: "Consultoria, Agendamento, Análise"

Sistema valida step 2
Sistema injeta passo 3

Resposta:
✅ Perfeito! Seus serviços:
• Consultoria
• Agendamento
• Análise

3️⃣ HORÁRIOS DE OPERAÇÃO
Formato: Dias|Início|Fim|Fechamento
```

### Step 4: Horários
```
Gestor: "Segunda a Sexta|09:00|18:00|Sábados e Domingos"

✅ Horários configurados!
Segunda a Sexta | 09:00 - 18:00
Fechamento: Sábados e Domingos

4️⃣ REGRAS DE RESERVA
```

### Step 5: Regras
```
Gestor: "Prazo mínimo 24h, confirmação obrigatória, 50% adiantamento"

✅ Regras de reserva salvas!

5️⃣ EXEMPLOS DE RESPOSTA
[Última etapa]
```

### Step 6: Exemplos
```
Gestor: "Qual o preço?|Depende do projeto, vamos conversar|Quantas horas?|Geralmente 40-80h"

✅ Exemplos salvos! (2 exemplos)

Seu bot está pronto! 🎉
```

## 🔧 Customização

### Adicionar Novo Step

Em `src/services/manager-prompts.js`:

```javascript
const ONBOARDING_STEPS = {
  // ... steps 1-5
  6: {
    id: 'seu_campo',
    title: '6️⃣ Seu Campo',
    description: 'Descrição',
    format: 'text'
  }
};
```

Em `src/services/librechat-manager.js`:

```javascript
case 6: // Seu step
  // Parse logic
  if (validation) {
    return { success: true, value };
  }
  return { error: true, message: '...' };
```

### Adicionar Novo Modo

Em `src/services/manager-prompts.js`:

```javascript
function getManagerYourModePrompt(managerName, config) {
  return `Your custom system prompt for this mode`;
}
```

## 📝 Logging & Audit

Toda ação do gestor é registrada em `manager_audit_log`:

```javascript
await logManagerAction(managerId, 'bot_activated', {
  config: finalConfig,
  timestamp: new Date()
});
```

Ver histórico:
```javascript
const logs = await getManagerAuditLog(managerId);
```

## ⚠️ Segurança

- ✅ MongoDB URI em variáveis de ambiente
- ✅ Validação de entrada em cada step
- ✅ Audit trail completo
- ✅ Índices de banco para performance
- ✅ Rate limiting (adicione conforme necessário)

## 🐛 Troubleshooting

### MongoDB não conecta
```bash
# Verificar MONGODB_URI no .env
# Testar conexão:
node -e "require('./src/services/manager-db').connect()"
```

### First access não dispara
```bash
# Limpar MongoDB
# Reiniciar servidor
# Verificar req.user está sendo passado corretamente
```

### System prompt não injeta
```bash
# Verificar middleware está registrado
# Verificar managerOnboardingMiddleware é chamado antes de usar req.systemPrompt
```

## 📚 Próximos Passos

1. ✅ Criar `/src/middlewares/manager-onboarding.js` (wrapper)
2. ⏳ Integrar com LibreChat API real
3. ⏳ Adicionar autenticação OAuth
4. ⏳ Dashboard de monitoramento
5. ⏳ Export/import de configurações

## 📞 Support

Para dúvidas sobre integração, verificar:
- Logs em `[Manager API]` e `[MongoDB]`
- Audit trail em `manager_audit_log`
- Status do bot com: `GET /api/manager/config`
