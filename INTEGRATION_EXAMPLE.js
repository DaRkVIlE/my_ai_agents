/**
 * Integration Example: Manager Onboarding with Existing Index.js
 * 
 * This file shows how to integrate the manager onboarding system
 * into your existing Express server in src/index.js
 * 
 * ADD THESE LINES to your existing src/index.js
 */

// ============================================================================
// STEP 1: Add these imports at the top of src/index.js
// ============================================================================

// Existing imports...
const { managerOnboardingMiddleware, processOnboardingResponse, buildOnboardingResponse } = require('./services/librechat-manager');
const { getOrCreateManager, getManagerConfig } = require('./services/manager-db');
const managerApi = require('./routes/manager-api');

// ============================================================================
// STEP 2: Initialize MongoDB connection on startup (after app.use(express.json()))
// ============================================================================

// Place this after: app.use(express.json());
(async () => {
  try {
    const { connect } = require('./services/manager-db');
    await connect();
    console.log('[Manager System] ✅ MongoDB connected successfully');
  } catch (err) {
    console.warn('[Manager System] ⚠️ MongoDB not available:', err.message);
  }
})();

// ============================================================================
// STEP 3: Register manager API routes (before app.listen)
// ============================================================================

// Place this after your existing routes (before app.listen):
app.use('/api/manager', managerApi);

// ============================================================================
// STEP 4: Optional - Add manager onboarding middleware
// ============================================================================

// If you want automatic system prompt injection for LibreChat users:
// Uncomment the line below:
// app.use(managerOnboardingMiddleware);

// ============================================================================
// STEP 5: Handle manager commands in existing message handler
// ============================================================================

// In your existing handleWebhook or message processing function,
// add this BEFORE sending the message to the LLM:

/*
// Add to handleWebhook function:

// Check if this is a manager (optional)
const isManager = req.user?.role === 'manager' || req.user?.isBusiness === true;

if (isManager && text) {
  // Handle manager commands
  const lowerText = text.toLowerCase();
  
  // Commands for manager onboarding/calibration
  if (lowerText === 'ativar bot' || lowerText === 'activate bot') {
    const { activateBot } = require('./services/librechat-manager');
    const result = await activateBot(req.user.id);
    if (result.success) {
      await sendMessage(clientId, remoteJid, result.message, config);
    } else {
      await sendMessage(clientId, remoteJid, result.message, config);
    }
    return res.status(200).send('OK');
  }
  
  if (lowerText === 'testar' || lowerText === 'test') {
    const { handleTestMode } = require('./services/librechat-manager');
    const testPrompt = await handleTestMode(req.user.id, text);
    await sendMessage(clientId, remoteJid, testPrompt.text, config);
    return res.status(200).send('OK');
  }
  
  if (lowerText.startsWith('editar ') || lowerText.startsWith('edit ')) {
    // Handle config editing
    const field = lowerText.split(' ')[1];
    await sendMessage(clientId, remoteJid, `Editando campo: ${field}. Qual é o novo valor?`, config);
    return res.status(200).send('OK');
  }
}
*/

// ============================================================================
// COMPLETE EXAMPLE: Integration into handleWebhook
// ============================================================================

/*

async function handleWebhookWithManagerSupport(req, res) {
  const body = req.body;
  const rawJid = body?.data?.key?.remoteJid || '';
  const isGroup = rawJid.endsWith('@g.us') || rawJid.includes('@g.us');
  const isStatus = rawJid === 'status@broadcast';
  const isFromMe = body?.data?.key?.fromMe === true;

  if (isGroup || isStatus || isFromMe) {
    return res.status(200).send('Ignored');
  }

  try {
    const { clientId } = req.params;
    const config = loadClientConfig(clientId);

    if (!config) {
      console.error(`[Webhook] Config não encontrada: ${clientId}`);
      return res.status(404).send('Client config not found');
    }

    // ── MANAGER ONBOARDING CHECK ─────────────────────────────────────────
    // Check if this is a manager's first access
    let systemPrompt = null;
    let managerId = null;

    if (req.user?.id) {
      const firstAccessData = await detectFirstAccess(req);
      if (firstAccessData?.isFirstAccess) {
        systemPrompt = firstAccessData.systemPrompt;
        managerId = firstAccessData.manager.manager_id;
        console.log(`[Manager] First access detected for: ${req.user.username}`);
      }
    }

    // ── Resto da lógica existente ────────────────────────────────────────
    const message = msgData.message;
    let text = '';

    if (message.conversation) {
      text = message.conversation;
    } else if (message.extendedTextMessage?.text) {
      text = message.extendedTextMessage.text;
    }

    if (!text) {
      return res.status(200).send('No content');
    }

    // Se for manager, processar comandos
    if (managerId) {
      const lowerText = text.toLowerCase();

      // ATIVAR BOT
      if (lowerText.includes('ativar bot')) {
        const { activateBot } = require('./services/librechat-manager');
        const result = await activateBot(managerId);
        await sendMessage(clientId, remoteJid, result.message, config);
        return res.status(200).send('OK');
      }

      // TESTAR
      if (lowerText.includes('testar')) {
        const { handleTestMode } = require('./services/librechat-manager');
        const testResult = await handleTestMode(managerId, text);
        await sendMessage(clientId, remoteJid, testResult.text, config);
        return res.status(200).send('OK');
      }

      // RELATÓRIO
      if (lowerText.includes('relatorio') || lowerText.includes('report')) {
        const { generateReport } = require('./services/librechat-manager');
        const report = await generateReport(managerId);
        await sendMessage(clientId, remoteJid, report, config);
        return res.status(200).send('OK');
      }
    }

    // ── Resto do fluxo existente (LLM, etc) ────────────────────────────
    const responseObj = await generateResponse(clientId, config, remoteJid, text, isAdmin, imageBase64);
    const replyText = typeof responseObj === 'string' ? responseObj : responseObj?.text;

    if (replyText) {
      await sendMessage(clientId, remoteJid, replyText, config);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook] Erro crítico:', error.message);
    res.status(500).send('Internal Server Error');
  }
}

*/

// ============================================================================
// ENVIRONMENT VARIABLES NEEDED
// ============================================================================

/*

Add to .env:

# MongoDB Atlas
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=commercial-ai-bots

*/

// ============================================================================
// PACKAGE.JSON UPDATES
// ============================================================================

/*

Add to package.json dependencies:

{
  "dependencies": {
    "mongodb": "^5.9.0"
  }
}

Then run:
npm install mongodb

*/

// ============================================================================
// DOCKER COMPOSE UPDATES (Optional)
// ============================================================================

/*

If using Docker, add to docker-compose.yml:

services:
  app:
    environment:
      - MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority
      - MONGODB_DB=commercial-ai-bots

*/

// ============================================================================
// TESTING
// ============================================================================

/*

Test the integration with curl:

1. Start onboarding:
curl -X POST http://localhost:8080/api/manager/onboard \
  -H "Content-Type: application/json" \
  -d '{
    "managerId": "test-manager-1",
    "username": "paulo",
    "businessName": "Ateliê Dhecor"
  }'

2. Process step 1 (tone):
curl -X POST http://localhost:8080/api/manager/onboarding/step \
  -H "Content-Type: application/json" \
  -d '{
    "managerId": "test-manager-1",
    "step": 1,
    "input": "casual"
  }'

3. Complete onboarding:
curl -X POST http://localhost:8080/api/manager/onboarding/complete \
  -H "Content-Type: application/json" \
  -d '{
    "managerId": "test-manager-1",
    "responses": {
      "tone": "casual",
      "services": ["Consultoria", "Agendamento"],
      "hours": {
        "dias": "Segunda a Sexta",
        "horario_inicio": "09:00",
        "horario_fim": "18:00",
        "fechamento": "Sábados e Domingos"
      },
      "reserva_agendamento": "Prazo mínimo 24h",
      "examples": [
        {"customer": "Qual o preço?", "reply": "Depende do projeto"}
      ]
    }
  }'

4. Get config:
curl http://localhost:8080/api/manager/config?managerId=test-manager-1

5. Activate bot:
curl -X POST http://localhost:8080/api/manager/bot/activate \
  -H "Content-Type: application/json" \
  -d '{"managerId": "test-manager-1"}'

6. Test bot response:
curl -X POST http://localhost:8080/api/manager/bot/test \
  -H "Content-Type: application/json" \
  -d '{
    "managerId": "test-manager-1",
    "question": "Qual é o preço?"
  }'

*/

// ============================================================================
// LIBRECHAT SPECIFIC INTEGRATION
// ============================================================================

/*

If using LibreChat as your frontend:

1. In your LibreChat custom endpoint config, add:

{
  "name": "Manager Onboarding",
  "apiKey": "your-api-key",
  "baseURL": "http://localhost:8080",
  "modelDisplayLabel": "Manager Bot",
  "groups": ["business-managers"]
}

2. When a manager sends first message, your backend receives:

req.user = {
  id: "user-uuid",
  username: "paulo",
  role: "business-manager",
  businessName: "Ateliê Dhecor"
}

3. Middleware automatically injects onboarding prompt:

req.systemPrompt = getManagerFirstAccessPrompt(...)

4. LLM receives this system prompt with the manager's message

5. Manager completes 5-step onboarding in natural chat

*/

// ============================================================================
// MIGRATION FROM EXISTING SYSTEM
// ============================================================================

/*

If you have existing manager configs in JSON files:

1. Create migration script:
   touch scripts/migrate-managers-to-mongodb.js

2. Script content:
   - Read existing JSON configs
   - Parse into manager profiles
   - Save to MongoDB
   - Verify data integrity

3. Run migration:
   node scripts/migrate-managers-to-mongodb.js

4. Keep JSON files as backup
   git commit before migration

*/

// ============================================================================
// MONITORING & DEBUGGING
// ============================================================================

/*

Monitor manager system:

1. Check logs:
   grep "\[Manager\]" app.log

2. Check MongoDB:
   db.manager_profiles.find()
   db.manager_audit_log.find().sort({timestamp:-1})

3. Check health:
   curl http://localhost:8080/api/manager/config?managerId=test

4. View audit trail:
   const logs = await getManagerAuditLog("manager-id")

*/

module.exports = {
  // Export for use in tests
  exampleConfig: {
    mongodbUri: 'mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority',
    mongodbDb: 'commercial-ai-bots'
  }
};
