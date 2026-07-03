/**
 * LibreChat Manager API Routes
 * 
 * Endpoints for manager onboarding and bot calibration
 * via LibreChat API integration.
 * 
 * Routes:
 * POST /api/manager/onboard - Start onboarding
 * POST /api/manager/onboarding/step - Process onboarding step
 * POST /api/manager/onboarding/complete - Complete onboarding
 * GET /api/manager/config - Get manager configuration
 * PUT /api/manager/config - Update manager configuration
 * POST /api/manager/bot/activate - Activate bot
 * POST /api/manager/bot/test - Test bot responses
 * GET /api/manager/report - Get manager report
 */

const express = require('express');
const router = express.Router();

const {
  detectFirstAccess,
  processOnboardingResponse,
  buildOnboardingResponse,
  handleTestMode,
  activateBot,
  validateBotConfig,
  generateReport
} = require('./librechat-manager');

const {
  getOrCreateManager,
  getManagerConfig,
  updateManagerConfig,
  completeOnboarding,
  getManagerStats,
  updateManagerStats,
  logManagerAction
} = require('./manager-db');

const {
  getManagerFirstAccessPrompt,
  getManagerCalibratingPrompt,
  getManagerValidationPrompt,
  ONBOARDING_STEPS
} = require('./manager-prompts');

/**
 * POST /api/manager/onboard
 * Start onboarding for a new manager
 */
router.post('/onboard', async (req, res) => {
  try {
    const { managerId, username, businessName } = req.body;

    if (!managerId || !username) {
      return res.status(400).json({
        error: 'managerId e username são obrigatórios'
      });
    }

    const manager = await getOrCreateManager(managerId, username, businessName);

    return res.status(200).json({
      success: true,
      isFirstAccess: manager.first_access,
      systemPrompt: getManagerFirstAccessPrompt(username, businessName),
      manager: {
        manager_id: manager.manager_id,
        username: manager.username,
        business_name: manager.business_name,
        first_access: manager.first_access,
        onboarding_completed: manager.onboarding_completed
      }
    });
  } catch (err) {
    console.error('[Manager API] Erro em /onboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/manager/onboarding/step
 * Process a single onboarding step
 */
router.post('/onboarding/step', async (req, res) => {
  try {
    const { managerId, step, input } = req.body;

    if (!managerId || !step || !input) {
      return res.status(400).json({
        error: 'managerId, step e input são obrigatórios'
      });
    }

    // Validar step (1-5)
    if (step < 1 || step > 5) {
      return res.status(400).json({
        error: 'Step deve estar entre 1 e 5'
      });
    }

    // Obter respostas atuais
    const manager = await getOrCreateManager(managerId, '', '');
    const currentResponses = manager.onboarding_responses || {};

    // Processar entrada
    const result = await processOnboardingResponse(managerId, step, input, currentResponses);

    if (result.error) {
      return res.status(400).json({
        error: result.message,
        suggestion: result.suggestion
      });
    }

    // Log
    await logManagerAction(managerId, `onboarding_step_${step}_completed`, {
      input,
      step,
      timestamp: new Date()
    });

    // Preparar próxima etapa
    let nextPrompt = '';
    if (result.nextStep <= 5) {
      nextPrompt = formatStepPrompt(result.nextStep, result.nextStepConfig);
    } else {
      // Onboarding completo — mostrar validação
      const finalConfig = buildFinalConfig(result.responses);
      nextPrompt = getManagerValidationPrompt(finalConfig);
    }

    return res.status(200).json({
      success: true,
      currentStep: step,
      nextStep: result.nextStep,
      confirmation: buildOnboardingResponse(step, result.parsed),
      nextPrompt,
      isComplete: result.nextStep > 5
    });
  } catch (err) {
    console.error('[Manager API] Erro em /onboarding/step:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/manager/onboarding/complete
 * Complete onboarding and save configuration
 */
router.post('/onboarding/complete', async (req, res) => {
  try {
    const { managerId, responses } = req.body;

    if (!managerId || !responses) {
      return res.status(400).json({
        error: 'managerId e responses são obrigatórios'
      });
    }

    // Construir configuração final
    const finalConfig = buildFinalConfig(responses);

    // Validar
    const validation = validateBotConfig(finalConfig);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        errors: validation.errors
      });
    }

    // Salvar
    await completeOnboarding(managerId, finalConfig);

    // Log
    await logManagerAction(managerId, 'onboarding_completed', {
      timestamp: new Date(),
      config: finalConfig
    });

    return res.status(200).json({
      success: true,
      message: '✅ Onboarding completo! Seu bot está configurado.',
      config: finalConfig,
      nextSteps: [
        '1. Teste o bot com: `testar`',
        '2. Ajuste o que precisar com: `editar {campo}`',
        '3. Ative com: `ativar bot`'
      ]
    });
  } catch (err) {
    console.error('[Manager API] Erro em /onboarding/complete:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/manager/config
 * Get manager's current configuration
 */
router.get('/config', async (req, res) => {
  try {
    const { managerId } = req.query;

    if (!managerId) {
      return res.status(400).json({
        error: 'managerId é obrigatório'
      });
    }

    const config = await getManagerConfig(managerId);

    if (!config) {
      return res.status(404).json({
        error: 'Configuração não encontrada. Comece o onboarding.',
        startOnboarding: true
      });
    }

    return res.status(200).json({
      success: true,
      config
    });
  } catch (err) {
    console.error('[Manager API] Erro em GET /config:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/manager/config
 * Update specific configuration field
 */
router.put('/config', async (req, res) => {
  try {
    const { managerId, field, value } = req.body;

    if (!managerId || !field || value === undefined) {
      return res.status(400).json({
        error: 'managerId, field e value são obrigatórios'
      });
    }

    const currentConfig = await getManagerConfig(managerId);
    if (!currentConfig) {
      return res.status(404).json({
        error: 'Configuração não encontrada'
      });
    }

    // Validar campo
    const validFields = ['tone', 'services', 'hours', 'reservation_rules', 'examples'];
    if (!validFields.includes(field)) {
      return res.status(400).json({
        error: `Campo inválido. Campos válidos: ${validFields.join(', ')}`
      });
    }

    const updatedConfig = {
      ...currentConfig,
      [field]: value
    };

    await updateManagerConfig(managerId, updatedConfig);

    // Log
    await logManagerAction(managerId, `config_updated_${field}`, {
      oldValue: currentConfig[field],
      newValue: value,
      timestamp: new Date()
    });

    return res.status(200).json({
      success: true,
      message: `Campo "${field}" atualizado com sucesso`,
      config: updatedConfig
    });
  } catch (err) {
    console.error('[Manager API] Erro em PUT /config:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/manager/bot/activate
 * Activate bot for customers
 */
router.post('/bot/activate', async (req, res) => {
  try {
    const { managerId } = req.body;

    if (!managerId) {
      return res.status(400).json({
        error: 'managerId é obrigatório'
      });
    }

    const result = await activateBot(managerId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json({
      success: true,
      message: result.message,
      botStatus: 'active'
    });
  } catch (err) {
    console.error('[Manager API] Erro em POST /bot/activate:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/manager/bot/test
 * Test bot response to a sample question
 */
router.post('/bot/test', async (req, res) => {
  try {
    const { managerId, question } = req.body;

    if (!managerId || !question) {
      return res.status(400).json({
        error: 'managerId e question são obrigatórios'
      });
    }

    const config = await getManagerConfig(managerId);
    if (!config) {
      return res.status(404).json({
        error: 'Configuração não encontrada'
      });
    }

    // Simular resposta usando config
    const simulatedResponse = simulateBotResponse(config, question);

    // Log
    await logManagerAction(managerId, 'bot_test', {
      question,
      response: simulatedResponse,
      timestamp: new Date()
    });

    return res.status(200).json({
      success: true,
      question,
      response: simulatedResponse,
      config: {
        tone: config.tone,
        services: config.services
      }
    });
  } catch (err) {
    console.error('[Manager API] Erro em POST /bot/test:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/manager/report
 * Get manager statistics and report
 */
router.get('/report', async (req, res) => {
  try {
    const { managerId } = req.query;

    if (!managerId) {
      return res.status(400).json({
        error: 'managerId é obrigatório'
      });
    }

    const config = await getManagerConfig(managerId);
    const stats = await getManagerStats(managerId);

    const report = generateReport(managerId);

    return res.status(200).json({
      success: true,
      report,
      config: {
        tone: config?.tone,
        services: config?.services?.length || 0,
        status: config?.bot_status || 'inactive'
      },
      stats: stats || {
        messages_sent: 0,
        messages_received: 0,
        total_chats: 0,
        satisfaction_score: 0
      }
    });
  } catch (err) {
    console.error('[Manager API] Erro em GET /report:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Helper: Format step prompt
 */
function formatStepPrompt(step, stepConfig) {
  const prompts = {
    2: `${stepConfig.title}\n${stepConfig.description}\n\nExemplo: ${stepConfig.placeholder}`,
    3: `${stepConfig.title}\n${stepConfig.description}\n\nFormato: Dias|Horário Início|Horário Fim|Dias de Fechamento\nExemplo: Segunda a Sexta|09:00|18:00|Sábados e Domingos`,
    4: `${stepConfig.title}\n${stepConfig.description}\n\nDescreva as políticas (prazo, confirmação, cancelamento, etc)`,
    5: `${stepConfig.title}\n${stepConfig.description}\n\nFormato: Pergunta 1|Resposta 1;Pergunta 2|Resposta 2`
  };

  return prompts[step] || stepConfig.description;
}

/**
 * Helper: Build final config from responses
 */
function buildFinalConfig(responses) {
  return {
    tone: responses.tone,
    services: responses.services || [],
    hours: responses.hours,
    reservation_rules: responses.reserva_agendamento,
    examples: responses.examples || [],
    bot_status: 'inactive', // Inicia inativo
    created_at: new Date(),
    updated_at: new Date()
  };
}

/**
 * Helper: Simulate bot response (simplified)
 */
function simulateBotResponse(config, question) {
  const tone = config.tone || 'formal';
  const services = config.services || [];

  // Resposta base
  let response = `Olá! `;

  // Ajustar tom
  if (tone === 'casual') response += `Tudo bem? `;
  else if (tone === 'energia_alta') response += `Que legal! `;

  // Responder à pergunta
  if (
    question.toLowerCase().includes('serviço') ||
    question.toLowerCase().includes('faz')
  ) {
    response += `Oferecemos: ${services.slice(0, 3).join(', ')}. `;
  } else if (
    question.toLowerCase().includes('horário') ||
    question.toLowerCase().includes('atende')
  ) {
    if (config.hours) {
      response += `Atendemos ${config.hours.dias} de ${config.hours.horario_inicio} a ${config.hours.horario_fim}. `;
    }
  } else if (
    question.toLowerCase().includes('agend') ||
    question.toLowerCase().includes('reserv')
  ) {
    response += `Ótimo! ${config.reservation_rules || 'Podemos agendar para você.'} `;
  } else {
    response += `Tenho certeza que posso ajudar! `;
  }

  response += `Como posso estar a serviço?`;

  return response;
}

module.exports = router;
