/**
 * LibreChat Manager Integration
 * 
 * Middleware and handlers for integrating manager onboarding
 * and calibration directly into LibreChat conversations.
 * 
 * Flow:
 * 1. Manager acessa LibreChat
 * 2. Sistema detecta first_access = true
 * 3. Injeta system prompt de onboarding
 * 4. Coleta respostas em 5 passos
 * 5. Salva configuração no MongoDB
 * 6. Ativa bot para clientes
 */

const {
  getOrCreateManager,
  updateOnboardingStep,
  completeOnboarding,
  updateManagerConfig,
  getManagerConfig,
  logManagerAction,
  completeFirstAccess,
  getOnboardingSession,
  saveOnboardingSession
} = require('./manager-db');

const {
  getManagerFirstAccessPrompt,
  getManagerCalibratingPrompt,
  getManagerTestingPrompt,
  getManagerAdminPrompt,
  getManagerValidationPrompt,
  getManagerMonitoringPrompt,
  ONBOARDING_STEPS
} = require('./manager-prompts');

/**
 * Detecta se é primeira vez que gestor acessa LibreChat
 */
async function detectFirstAccess(req) {
  const userId = req.user?.id;
  const username = req.user?.username;
  const businessName = req.body?.businessName || '';

  if (!userId || !username) {
    return null;
  }

  const manager = await getOrCreateManager(userId, username, businessName);
  return {
    isFirstAccess: manager.first_access,
    manager
  };
}

/**
 * Middleware para injetar system prompt de onboarding
 */
async function managerOnboardingMiddleware(req, res, next) {
  try {
    const firstAccessData = await detectFirstAccess(req);

    if (!firstAccessData) {
      return next();
    }

    const { isFirstAccess, manager } = firstAccessData;

    if (isFirstAccess) {
      // Primeira vez — injetar prompt de onboarding
      const managerName = manager.username || 'Gestor';
      const businessName = manager.business_name || 'seu negócio';

      req.systemPrompt = getManagerFirstAccessPrompt(managerName, businessName);
      req.isManagerOnboarding = true;
      req.managerId = manager.manager_id;
      req.onboardingStep = 0;

      // Log
      await logManagerAction(manager.manager_id, 'first_access', {
        timestamp: new Date()
      });
    } else if (!manager.onboarding_completed) {
      // Onboarding em progresso
      const managerName = manager.username || 'Gestor';
      const businessName = manager.business_name || 'seu negócio';

      req.systemPrompt = getManagerCalibratingPrompt(managerName, businessName, manager.config);
      req.isManagerCalibrating = true;
      req.managerId = manager.manager_id;
      req.onboardingStep = manager.onboarding_step;
    } else {
      // Onboarding completo — modo normal de calibração
      const managerName = manager.username || 'Gestor';
      const businessName = manager.business_name || 'seu negócio';

      req.systemPrompt = getManagerCalibratingPrompt(managerName, businessName, manager.config);
      req.isManagerCalibrating = true;
      req.managerId = manager.manager_id;
      req.managerConfig = manager.config;
    }

    req.manager = manager;
    next();
  } catch (err) {
    console.error('[Manager Onboarding] Erro no middleware:', err.message);
    next();
  }
}

/**
 * Processa respostas do gestor durante onboarding
 */
async function processOnboardingResponse(managerId, step, userMessage, currentResponses = {}) {
  const stepConfig = ONBOARDING_STEPS[step];

  if (!stepConfig) {
    return {
      error: true,
      message: 'Etapa inválida'
    };
  }

  try {
    const parsed = parseOnboardingInput(step, userMessage);

    if (!parsed.success) {
      return {
        error: true,
        message: parsed.error,
        suggestion: parsed.suggestion
      };
    }

    // Atualizar no banco
    const responses = {
      ...currentResponses,
      [stepConfig.id]: parsed.value
    };

    await updateOnboardingStep(managerId, step + 1, responses);

    return {
      success: true,
      nextStep: step + 1,
      responses,
      nextStepConfig: ONBOARDING_STEPS[step + 1]
    };
  } catch (err) {
    console.error(`[Onboarding] Erro ao processar step ${step}:`, err.message);
    return {
      error: true,
      message: 'Erro ao processar resposta. Tente novamente.'
    };
  }
}

/**
 * Parser para diferentes tipos de entrada no onboarding
 */
function parseOnboardingInput(step, input) {
  const stepConfig = ONBOARDING_STEPS[step];

  switch (step) {
    case 1: // Tom de voz
      const toneOption = stepConfig.options.find(
        opt => opt.value.toLowerCase() === input.toLowerCase()
      );

      if (toneOption) {
        return {
          success: true,
          value: toneOption.value,
          label: toneOption.label
        };
      }

      return {
        success: false,
        error: 'Tom de voz não reconhecido.',
        suggestion: `Escolha entre: ${stepConfig.options.map(o => o.label).join(', ')}`
      };

    case 2: // Serviços
      const services = input
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      if (services.length === 0) {
        return {
          success: false,
          error: 'Forneça pelo menos um serviço.',
          suggestion: 'Exemplo: Consultoria, Agendamento, Suporte Técnico'
        };
      }

      return {
        success: true,
        value: services
      };

    case 3: // Horários
      // Formato esperado: "segunda a sexta|09:00|18:00|sábados e domingos"
      const hoursMatch = input.match(/^(.+?)\|(.+?)\|(.+?)(?:\|(.+))?$/);

      if (!hoursMatch) {
        return {
          success: false,
          error: 'Formato de horário inválido.',
          suggestion:
            'Use: "Segunda a Sexta|09:00|18:00|Sábados e Domingos"'
        };
      }

      return {
        success: true,
        value: {
          dias: hoursMatch[1].trim(),
          horario_inicio: hoursMatch[2].trim(),
          horario_fim: hoursMatch[3].trim(),
          fechamento: hoursMatch[4]?.trim() || ''
        }
      };

    case 4: // Regras de reserva
      if (input.trim().length < 10) {
        return {
          success: false,
          error: 'Descreva as regras com mais detalhes.',
          suggestion:
            'Exemplo: Prazo mínimo 24h, confirmação requerida, 50% de adiantamento'
        };
      }

      return {
        success: true,
        value: input.trim()
      };

    case 5: // Exemplos
      // Formato: "pergunta 1 | resposta 1 ; pergunta 2 | resposta 2"
      const examplesStr = input.split(';').map(s => s.trim());
      const examples = [];

      for (const example of examplesStr) {
        const [customer, reply] = example.split('|');
        if (customer && reply) {
          examples.push({
            customer: customer.trim(),
            reply: reply.trim()
          });
        }
      }

      if (examples.length === 0) {
        return {
          success: false,
          error: 'Nenhum exemplo válido detectado.',
          suggestion:
            'Formato: "Pergunta 1|Resposta 1;Pergunta 2|Resposta 2"'
        };
      }

      return {
        success: true,
        value: examples
      };

    default:
      return {
        success: false,
        error: 'Etapa desconhecida'
      };
  }
}

/**
 * Constrói a próxima resposta do bot durante onboarding
 */
function buildOnboardingResponse(step, parsedInput) {
  const stepConfig = ONBOARDING_STEPS[step];

  const confirmations = {
    1: `✅ Ótimo! Tom de voz: **${parsedInput.label}**\n\nAgora vamos para o próximo passo...`,
    2: `✅ Perfeito! Seus serviços:\n${parsedInput.value.map(s => `• ${s}`).join('\n')}\n\nPróximo...`,
    3: `✅ Horários configurados!\n**${parsedInput.value.dias}** | ${parsedInput.value.horario_inicio} - ${parsedInput.value.horario_fim}${
      parsedInput.value.fechamento ? `\nFechamento: ${parsedInput.value.fechamento}` : ''
    }\n\nContinuando...`,
    4: `✅ Regras de reserva salvas!\n"${parsedInput.value}"\n\nUma última coisa...`,
    5: `✅ Exemplos salvos! (${parsedInput.value.length} exemplo(s))\n\nSeu bot está pronto! 🎉`
  };

  return confirmations[step] || 'Resposta registrada!';
}

/**
 * Handler para comando de modo teste
 */
async function handleTestMode(managerId, userMessage) {
  const config = await getManagerConfig(managerId);

  if (!config) {
    return {
      text: '⚠️ Configure o bot primeiro antes de testar.',
      mode: 'error'
    };
  }

  return {
    text: getManagerTestingPrompt(config.business_name || 'Seu Negócio', config),
    mode: 'testing'
  };
}

/**
 * Handler para ativar bot
 */
async function activateBot(managerId) {
  const config = await getManagerConfig(managerId);

  if (!config) {
    return {
      success: false,
      message: '⚠️ Configure o bot primeiro.'
    };
  }

  // Validar configuração
  const validation = validateBotConfig(config);
  if (!validation.valid) {
    return {
      success: false,
      message: validation.errors.join('\n')
    };
  }

  // Ativar
  await updateManagerConfig(managerId, {
    ...config,
    bot_status: 'active'
  });

  await logManagerAction(managerId, 'bot_activated', {
    timestamp: new Date()
  });

  return {
    success: true,
    message: '🟢 Bot ativado! Agora atenderá seus clientes.'
  };
}

/**
 * Valida configuração do bot
 */
function validateBotConfig(config) {
  const errors = [];

  if (!config.tone) errors.push('❌ Tom de voz não configurado');
  if (!config.services || config.services.length === 0) errors.push('❌ Serviços não configurados');
  if (!config.hours) errors.push('❌ Horários não configurados');
  if (!config.examples || config.examples.length === 0) errors.push('❌ Exemplos não configurados');

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Handler para relatório/estatísticas
 */
async function generateReport(managerId) {
  const config = await getManagerConfig(managerId);

  if (!config) {
    return 'Nenhuma configuração disponível ainda.';
  }

  const report = `
📊 **RELATÓRIO DE CONFIGURAÇÃO**

**Bot Status:** ${config.bot_status === 'active' ? '🟢 Ativo' : '🔴 Inativo'}

**Configurações:**
• Tom: ${config.tone || '❌ Não configurado'}
• Serviços: ${config.services?.length || 0} configurado(s)
• Horários: ${config.hours ? '✅ Configurado' : '❌ Não configurado'}
• Exemplos: ${config.examples?.length || 0} exemplo(s)

**Próximos Passos:**
${config.bot_status === 'inactive' ? '- Ativar bot com comando: \`ativar bot\`' : '- Monitorar estatísticas com: \`relatorio\`'}
- Editar configurações com: \`editar {campo}\`
- Testar respostas com: \`testar\`
`;

  return report;
}

module.exports = {
  detectFirstAccess,
  managerOnboardingMiddleware,
  processOnboardingResponse,
  parseOnboardingInput,
  buildOnboardingResponse,
  handleTestMode,
  activateBot,
  validateBotConfig,
  generateReport
};
