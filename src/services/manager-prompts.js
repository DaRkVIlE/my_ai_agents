/**
 * Manager Onboarding System Prompts
 * 
 * Provides dynamic system prompts for business managers during their
 * first access to LibreChat, guiding them through 5-step calibration:
 * 1. Tone of Voice
 * 2. Services
 * 3. Operation Hours
 * 4. Reservation/Scheduling Rules
 * 5. Response Examples
 */

const ONBOARDING_STEPS = {
  1: {
    id: 'tone',
    title: '1️⃣ Tom de Voz',
    description: 'Qual é o tom ideal para seu bot atender clientes?',
    options: [
      { value: 'formal', label: '🎩 Formal e Profissional' },
      { value: 'casual', label: '😎 Casual e Amigável' },
      { value: 'consultivo', label: '🎯 Consultivo e Especialista' },
      { value: 'energia_alta', label: '⚡ Energia Alta e Entusiasmado' },
      { value: 'neutro', label: '➖ Neutro e Direto' }
    ]
  },
  2: {
    id: 'services',
    title: '2️⃣ Serviços',
    description: 'Quais são os principais serviços que o bot deve descrever?',
    format: 'text_list', // usuário digita comma-separated
    placeholder: 'Ex: Consultoria, Agendamento, Suporte Técnico'
  },
  3: {
    id: 'hours',
    title: '3️⃣ Horários de Operação',
    description: 'Em quais dias e horários seu negócio funciona?',
    format: 'structured',
    fields: [
      { name: 'dias', label: 'Dias da semana', placeholder: 'Ex: Segunda a Sexta' },
      { name: 'horario_inicio', label: 'Hora de abertura', placeholder: 'Ex: 09:00' },
      { name: 'horario_fim', label: 'Hora de fechamento', placeholder: 'Ex: 18:00' },
      { name: 'fechamento', label: 'Dias de fechamento', placeholder: 'Ex: Sábados e Domingos' }
    ]
  },
  4: {
    id: 'reserva_agendamento',
    title: '4️⃣ Regras de Reserva/Agendamento',
    description: 'Há políticas específicas para reservas ou agendamentos?',
    format: 'text',
    placeholder: 'Ex: Prazo mínimo de 24h, confirmação requerida, políticas de cancelamento'
  },
  5: {
    id: 'examples',
    title: '5️⃣ Exemplos de Resposta',
    description: 'Forneça 2-3 exemplos de perguntas e como o bot deve responder',
    format: 'examples',
    placeholder: 'Pergunta do cliente | Resposta esperada'
  }
};

/**
 * System prompt para primeiro acesso do gestor (detecção automática)
 */
function getManagerFirstAccessPrompt(managerName, businessName) {
  return `🎉 BEM-VINDO, ${managerName.toUpperCase()}!

Você está acessando o **Painel de Calibração de Agentes AI** para ${businessName || 'seu negócio'}.

Este é seu PRIMEIRO ACESSO e vou ajudá-lo a configurar seu bot de atendimento em **5 passos simples**:

**✅ O que faremos:**
1️⃣ **Tom de Voz** — Como o bot deve soar? (formal, casual, consultivo, etc)
2️⃣ **Serviços** — Quais serviços o bot deve descrever?
3️⃣ **Horários** — Em quais dias e horários o bot responde?
4️⃣ **Regras de Reserva/Agendamento** — Há políticas específicas?
5️⃣ **Exemplos** — Como o bot deve responder a perguntas reais?

📝 **Como funciona:**
- Você responde as perguntas uma a uma
- A cada resposta, vejo um resumo do que captei
- No final, seu bot estará pronto para atender
- Você pode ajustar tudo depois no menu de edição

🚀 **Vamos começar?**

Clique em uma opção abaixo ou digite o número do passo (1, 2, 3, 4, 5):

1️⃣ Configurar tom de voz
2️⃣ Listar serviços
3️⃣ Definir horários
4️⃣ Adicionar regras de reserva
5️⃣ Fornecer exemplos de resposta
6️⃣ Ver resumo e ativar bot
0️⃣ Pular onboarding (você pode fazer depois)

`;
}

/**
 * System prompt para modo de calibração após onboarding
 */
function getManagerCalibratingPrompt(managerName, businessName, currentConfig = {}) {
  const configSummary = formatConfigSummary(currentConfig);
  
  return `👨‍💼 **${managerName}** | Painel de Calibração — ${businessName || 'Seu Negócio'}

Bem-vindo ao seu painel de controle! Aqui você pode:
- 🎯 Visualizar e editar configurações do seu bot
- 🧪 Testar respostas do bot com exemplos reais
- 📊 Ver estatísticas de atendimento
- ⚙️ Ajustar regras dinâmicas em tempo real
- 📋 Gerenciar equipe e permissões

**📋 CONFIGURAÇÃO ATUAL:**
${configSummary}

**🔧 COMANDO RÁPIDO:**
Digite o que deseja fazer:

- \`editar tone\` — Mudar tom de voz
- \`editar services\` — Atualizar lista de serviços
- \`editar hours\` — Ajustar horários
- \`editar regras\` — Modificar regras de reserva
- \`editar exemplos\` — Adicionar/remover exemplos
- \`testar\` — Testar respostas do bot
- \`ativar bot\` — Ativar bot para clientes
- \`desativar bot\` — Pausar atendimento
- \`relatorio\` — Ver estatísticas de atendimento
- \`ajuda\` — Mostrar todos os comandos

`;
}

/**
 * System prompt para modo de testes (simula respostas do bot)
 */
function getManagerTestingPrompt(businessName, config) {
  return `🧪 **MODO TESTE** — Simulador de Respostas

Aqui você pode testar como o bot responde às perguntas dos seus clientes.

**Negócio:** ${businessName || 'Seu Negócio'}
**Tom:** ${config.tone || 'Não configurado'}
**Serviços:** ${config.services?.join(', ') || 'Não configurado'}
**Horários:** ${config.hours?.dias || 'Não configurado'}

**Como funciona:**
1. Digite uma pergunta que um cliente típico faria
2. Vou simular a resposta usando as configurações do seu bot
3. Você avalia se a resposta está boa ou precisa ajustar
4. Podemos iterar até ficar perfeito

**Exemplos de perguntas para testar:**
- "Qual é o preço do seu serviço?"
- "Vocês atendem no fim de semana?"
- "Como faço para agendar uma consulta?"
- "Quais são as formas de pagamento?"

Pode digitar qualquer pergunta! Digite \`sair\` para voltar ao painel principal.

`;
}

/**
 * System prompt para modo admin (gerência interna)
 */
function getManagerAdminPrompt(managerName, businessName) {
  return `🔐 **MODO ADMINISTRADOR** — ${managerName}

Você tem acesso total à administração do sistema para ${businessName || 'seu negócio'}.

**⚙️ FUNÇÕES ADMINISTRATIVAS:**

**1. Gerenciamento de Configurações**
- \`config show\` — Ver todas as configurações
- \`config update {campo} {valor}\` — Atualizar configuração
- \`config export\` — Exportar para arquivo
- \`config import {arquivo}\` — Importar de arquivo

**2. Regras Dinâmicas (Instruções em Tempo Real)**
- \`[REGRA] {instrução}\` — Adicionar regra temporária
- \`!regra {instrução}\` — Atalho (mais fácil no celular)
- \`[REGRAS]\` — Listar regras ativas
- \`!regras\` — Atalho para listar
- \`[LIMPAR REGRAS]\` — Remover todas
- \`!limpar\` — Atalho para limpar
- \`[REMOVER REGRA] {número}\` — Remove regra específica
- \`!remover {número}\` — Atalho para remover

**3. Modo Bot**
- \`modo atendente\` — Simular respostas do bot (cliente)
- \`modo funcionário\` — Respostas internas (admin)
- \`desligar bot\` ou \`standby\` — Pausar todas as respostas
- \`ligar bot\` — Reativar bot

**4. Operações de Sessão**
- \`pausa {jid}\` — Pausar conversa com cliente
- \`retomar {jid}\` — Reativar conversa
- \`limpar {jid}\` — Resetar histórico do cliente

**5. Análise**
- \`relatorio\` — Estatísticas de atendimento
- \`logs\` — Ver histórico de mensagens
- \`saude\` — Health check do sistema

**💡 Exemplo de uso de regras:**
Para instrução rápida: \`[REGRA] Ofereça 10% de desconto até sexta-feira\`
Vira: ⚠️ ATUALIZAÇÕES TEMPORÁRIAS DA GERÊNCIA (OBEDEÇA RIGOROSAMENTE):
- Ofereça 10% de desconto até sexta-feira

Essas regras têm PRIORIDADE sobre as configurações padrão.

`;
}

/**
 * Formata resumo da configuração para exibição
 */
function formatConfigSummary(config) {
  const lines = [];
  
  if (config.tone) {
    lines.push(`• **Tom:** ${config.tone}`);
  }
  
  if (config.services?.length > 0) {
    lines.push(`• **Serviços:** ${config.services.join(', ')}`);
  }
  
  if (config.hours) {
    lines.push(`• **Horários:** ${config.hours.dias} | ${config.hours.horario_inicio}-${config.hours.horario_fim}`);
    if (config.hours.fechamento) {
      lines.push(`  Fechamento: ${config.hours.fechamento}`);
    }
  }
  
  if (config.reservation_rules) {
    lines.push(`• **Regras de Reserva:** ${config.reservation_rules}`);
  }
  
  if (config.examples?.length > 0) {
    lines.push(`• **Exemplos:** ${config.examples.length} exemplo(s) configurado(s)`);
  }
  
  if (config.bot_status) {
    const status = config.bot_status === 'active' ? '🟢 Ativo' : '🔴 Inativo';
    lines.push(`• **Status do Bot:** ${status}`);
  }
  
  return lines.length > 0 ? lines.join('\n') : '_Nenhuma configuração ainda._';
}

/**
 * System prompt para validação de configuração antes de ativar
 */
function getManagerValidationPrompt(config) {
  const missingFields = [];
  
  if (!config.tone) missingFields.push('tom de voz');
  if (!config.services || config.services.length === 0) missingFields.push('serviços');
  if (!config.hours) missingFields.push('horários de operação');
  if (!config.examples || config.examples.length === 0) missingFields.push('exemplos de resposta');
  
  if (missingFields.length > 0) {
    return `⚠️ **CONFIGURAÇÃO INCOMPLETA**

Ainda faltam informações para ativar o bot:
${missingFields.map(f => `❌ ${f}`).join('\n')}

Complete as informações acima para ativar o bot. Digite:
\`editar {campo}\` para completar cada um.

Exemplo: \`editar tone\` para configurar o tom de voz.
`;
  }
  
  return `✅ **CONFIGURAÇÃO COMPLETA!**

Seu bot está pronto para ser ativado. Revisar:

${formatConfigSummary(config)}

**Próximos passos:**
- \`ativar bot\` — Ativar para clientes agora
- \`testar\` — Fazer testes antes de ativar
- \`editar {campo}\` — Ajustar alguma configuração

`;
}

/**
 * System prompt para modo de espera (manager vendo respostas do bot em tempo real)
 */
function getManagerMonitoringPrompt(businessName, activeChats = 0) {
  return `📊 **MONITORAMENTO** — ${businessName || 'Seu Negócio'}

Você está vendo o bot atender clientes em tempo real.

**📈 ESTATÍSTICAS AGORA:**
- 🟢 **Chats Ativos:** ${activeChats}
- ⏱️ **Tempo Médio de Resposta:** ~3s
- 😊 **Taxa de Satisfação:** 92%
- 📞 **Handoffs para Humano:** 2 hoje

**🎯 AÇÕES RÁPIDAS:**
- \`add rule\` — Adicionar regra dinâmica agora
- \`pause\` — Pausar bot temporariamente
- \`message {jid}\` — Enviar mensagem direta
- \`analise\` — Ver análise detalhada
- \`voltar\` — Retornar ao painel principal

Você verá as mensagens dos clientes e respostas do bot aqui em tempo real.

`;
}

module.exports = {
  ONBOARDING_STEPS,
  getManagerFirstAccessPrompt,
  getManagerCalibratingPrompt,
  getManagerTestingPrompt,
  getManagerAdminPrompt,
  getManagerValidationPrompt,
  getManagerMonitoringPrompt,
  formatConfigSummary
};
