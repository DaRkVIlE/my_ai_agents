const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chat } = require('./llm');
const { getSession, setSession, getDynamicRules, setDynamicRules, clearDynamicRules, logInteraction, setLastActivity } = require('./redis');
const { buildAidaSystemPrompt, buildImmersionOpeningPrompt, detectSessionEnd } = require('./aida-engine');
const apiRouter = require('./apiRouter');

const MAX_DYNAMIC_RULES = 10;

// ── NOTIFICAÇÃO DE RESERVA ───────────────────────────────────────────────────────────────
async function sendReservationNotification(config, reservaData, clienteJid) {
    if (!config.notificacao_reserva?.ativo || !config.notificacao_reserva?.destino_notificacao) return;
    if (!config.instanceName || !config.instanceApiKey) return;

    const evolutionUrl = process.env.EVOLUTION_API_URL || 'https://evolution-api-production-9afd.up.railway.app';
    const { nome, data, horario, pessoas, ocasiao } = reservaData;

    const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const clienteNumero = clienteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');

    const mensagem =
        `📍 *NOVA SOLICITACAO DE RESERVA*\n` +
        `────────────────────\n` +
        `👤 *Nome:* ${nome || 'Não informado'}\n` +
        `📅 *Data:* ${data || 'Não informada'}\n` +
        `🕐 *Horário:* ${horario || 'Não informado'}\n` +
        `👥 *Pessoas:* ${pessoas || 'Não informado'}\n` +
        (ocasiao && ocasiao !== 'nenhuma' ? `🎉 *Ocasião:* ${ocasiao}\n` : '') +
        `────────────────────\n` +
        `📲 *WhatsApp cliente:* ${clienteNumero}\n` +
        `⏰ *Recebido em:* ${agora}\n\n` +
        `_Responda diretamente a esse número para confirmar a reserva._`;

    try {
        const response = await fetch(
            `${evolutionUrl}/message/sendText/${config.instanceName}`,
            {
                method: 'POST',
                headers: {
                    'apikey': config.instanceApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    number: config.notificacao_reserva.destino_notificacao,
                    text: mensagem
                })
            }
        );
        if (response.ok) {
            console.log(`[Reserva] ✅ Notificação enviada para a gerência: ${nome} | ${data} | ${horario} | ${pessoas}px`);
        } else {
            const err = await response.text();
            console.error(`[Reserva] ❌ Falha ao notificar gerência: ${err}`);
        }
    } catch (e) {
        console.error('[Reserva] ❌ Erro na requisição de notificação:', e.message);
    }
}

// ── REGRAS DINÂMICAS — Interceptação de comandos admin ───────────────────────
async function handleDynamicRuleCommand(clientId, userMessage) {
    const msg = userMessage.trim();

    // [REGRA] texto — adicionar nova regra
    const addMatch = msg.match(/^\[REGRA\]\s*(.+)/is);
    if (addMatch) {
        const novaRegra = addMatch[1].trim();
        if (!novaRegra) {
            return '⚠️ Formato: [REGRA] seguido da instrução.\nExemplo: [REGRA] 86 no salmão';
        }
        const rules = await getDynamicRules(clientId);
        if (rules.length >= MAX_DYNAMIC_RULES) {
            return `⚠️ Limite de ${MAX_DYNAMIC_RULES} regras atingido.\nUse [LIMPAR REGRAS] para resetar ou [REMOVER REGRA] {número} para liberar espaço.`;
        }
        rules.push(novaRegra);
        await setDynamicRules(clientId, rules);
        const lista = rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
        return `✅ Regra aplicada com sucesso!\n\n📋 *Regras ativas agora:*\n${lista}\n\n⏰ Expira automaticamente em ~18h.\nPara listar: [REGRAS]\nPara limpar tudo: [LIMPAR REGRAS]`;
    }

    // [LIMPAR REGRAS] — remover todas
    if (/^\[LIMPAR REGRAS\]/i.test(msg)) {
        await clearDynamicRules(clientId);
        return '✅ Todas as regras dinâmicas foram removidas.\nO bot voltou ao comportamento padrão.';
    }

    // [REMOVER REGRA] número — remover específica
    const removeMatch = msg.match(/^\[REMOVER REGRA\]\s*(\d+)/i);
    if (removeMatch) {
        const idx = parseInt(removeMatch[1], 10) - 1;
        const rules = await getDynamicRules(clientId);
        if (idx < 0 || idx >= rules.length) {
            return `⚠️ Número inválido. Use [REGRAS] para ver a lista (1 a ${rules.length}).`;
        }
        const removida = rules.splice(idx, 1)[0];
        await setDynamicRules(clientId, rules);
        const lista = rules.length > 0
            ? rules.map((r, i) => `${i + 1}. ${r}`).join('\n')
            : 'Nenhuma regra ativa.';
        return `✅ Regra removida: "${removida}"\n\n📋 *Regras ativas:*\n${lista}`;
    }

    // [REGRAS] — listar ativas
    if (/^\[REGRAS\]$/i.test(msg)) {
        const rules = await getDynamicRules(clientId);
        if (rules.length === 0) {
            return '📋 Nenhuma regra dinâmica ativa no momento.\nO bot está operando com as configurações padrão.';
        }
        const lista = rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
        return `📋 *Regras ativas (${rules.length}/${MAX_DYNAMIC_RULES}):*\n${lista}\n\n⏰ Expira automaticamente em ~18h.`;
    }

    // ── Atalhos sem colchete (mais fácil no celular) ──────────────────────
    // Aceita variações naturais que o gestor digitaria no celular:
    //   !regra <texto>                    → adicionar regra
    //   !regras / !listar / !ver regras   → listar regras
    //   !limpar / !limpar regras / !apagar → limpar todas
    //   !remover N / !remover regra N     → remover específica

    // ADICIONAR: !regra <texto> ou !termo <texto>
    const aliasAdd = msg.match(/^!(?:regra|termo)\s+(.+)/is);
    if (aliasAdd) return handleDynamicRuleCommand(clientId, `[REGRA] ${aliasAdd[1].trim()}`);

    // LISTAR: !regras, !listar, !listar regras, !ver regras, !mostrar regras
    if (/^!(?:regras|termos|listar(?:\s+regras?)?|ver(?:\s+regras?)?|mostrar(?:\s+regras?)?)$/i.test(msg)) {
        return handleDynamicRuleCommand(clientId, '[REGRAS]');
    }

    // LIMPAR: !limpar, !limpar regras, !apagar, !apagar regras, !resetar
    if (/^!(?:limpar|apagar|resetar)(?:\s+(?:regras?|tudo))?$/i.test(msg)) {
        return handleDynamicRuleCommand(clientId, '[LIMPAR REGRAS]');
    }

    // REMOVER: !remover N, !remover regra N, !deletar N
    const aliasRemove = msg.match(/^!(?:remover|deletar)(?:\s+regra)?\s+(\d+)/i);
    if (aliasRemove) return handleDynamicRuleCommand(clientId, `[REMOVER REGRA] ${aliasRemove[1]}`);

    // Não é um comando de regra dinâmica
    return null;
}

function getAttendantPrompt(config, dynamicRules = [], userProfile = null) {
    // Extrai apenas as chaves de conhecimento de negócio (exclui credenciais e metadados de sistema)
    const {
        name, tone, services, targetAudience, attendant, instanceName, instanceApiKey,
        testMode, testAllowedNumbers, adminNumbers, adminPrompt, examples, notificacao_reserva, vision_instructions, ...businessRules
    } = config;

    // Injeta a instrução do marcador de reserva se o sistema estiver ativo
    const reservaInstruction = notificacao_reserva?.ativo && notificacao_reserva?.instrucao_llm
        ? `\n7. ${notificacao_reserva.instrucao_llm}`
        : '';
        
    // Injeta instruções de visão computacional se existirem
    const visionInstruction = vision_instructions?.ativo && vision_instructions?.prompt_adicional
        ? `\n\n👁️ INSTRUÇÕES DE ANÁLISE DE IMAGEM:\n${vision_instructions.prompt_adicional}`
        : '';

    // Injeta regras dinâmicas da gerência (se houver)
    const dynamicBlock = dynamicRules.length > 0
        ? `\n\n⚠️ ATUALIZAÇÕES TEMPORÁRIAS DA GERÊNCIA (OBEDEÇA RIGOROSAMENTE):\n${dynamicRules.map(r => `- ${r}`).join('\n')}\nEstas instruções têm PRIORIDADE sobre o cardápio e regras padrão acima.`
        : '';

    // Injeta Perfil do Aluno (se aplicável ao bot)
    const profileBlock = userProfile
        ? `\n\n👤 PERFIL DO ALUNO (USE PARA PERSONALIZAR A INTERAÇÃO):\n- Nível Reportado: ${userProfile.nivel || 'Desconhecido'}\n- Interesse/Tema: ${userProfile.interesse || 'Geral'}\n- Objetivo: ${userProfile.objetivo || 'Não informado'}\n- Tom Preferido: ${userProfile.tom || 'Neutro'}\n\n*INSTRUÇÃO CRÍTICA:* Incorpore o interesse principal e o objetivo do aluno sutilmente nas suas respostas e na criação das cenas. Adapte seu vocabulário para o nível reportado.`
        : '';

    return `Você é o assistente virtual do negócio: ${config.name}.
Tom de voz: ${config.tone}.
Público Alvo: ${config.targetAudience || ''}.

📋 REGRAS DE NEGÓCIO E BASE DE CONHECIMENTO:
${JSON.stringify(businessRules, null, 2)}

Abaixo estão exemplos de como você deve responder:
${JSON.stringify(config.examples || config.attendant?.examples || [], null, 2)}

🚨 DIRETRIZES IMPORTANTES (OBRIGATÓRIAS):
1. Seja conciso, prestativo e persuasivo.
2. NUNCA CONFIRME RESERVAS OU AGENDAMENTOS POR CONTA PRÓPRIA. Sempre encerre dizendo que a equipe irá confirmar a disponibilidade.
3. A saudação inicial JÁ FOI ENVIADA para o cliente. Portanto, NUNCA inicie suas respostas com saudações (ex: "Olá", "Boa tarde", "Seja bem vindo").
4. Vá direto ao ponto e responda DIRETAMENTE à pergunta ou comentário do usuário.
5. Se o usuário mandar um áudio (aparecerá como [ÁUDIO TRANSCRITO]), responda ao conteúdo da transcrição naturalmente.
6. Quando pedir para o cliente enviar uma foto/imagem para avaliação ou orçamento, instrua-o sempre a enviar a foto JUNTO com uma legenda ou áudio explicando os detalhes do que ele deseja.${reservaInstruction}${visionInstruction}${dynamicBlock}${profileBlock}`;
}

async function generateResponse(clientId, config, remoteJid, userMessage, isAdmin = false, imageBase64 = null, userProfile = null) {
    const lowerMsg = userMessage.toLowerCase();

    // ── INTERCEPTAÇÃO DE REGRAS DINÂMICAS (Admin only, antes de tudo) ─────
    if (isAdmin) {
        const ruleResponse = await handleDynamicRuleCommand(clientId, userMessage);
        if (ruleResponse) {
            console.log(`[Regras Dinâmicas] Comando processado de admin: ${userMessage.substring(0, 50)}`);
            return { text: ruleResponse, greeting: null };
        }
    }

    // Command interception for persona switching (only for admins)
    if (isAdmin) {
        if (/(modo atendente|modo cliente)/.test(lowerMsg)) {
            const dynamicRules = await getDynamicRules(clientId);
            const systemPrompt = getAttendantPrompt(config, dynamicRules);
            const msgs = [{ role: 'system', content: systemPrompt }];

            if (config.attendant?.greeting) {
                const greeting = applyTimeGreeting(config.attendant.greeting);
                msgs.push({ role: 'assistant', content: greeting });
            }

            await setSession(clientId, remoteJid, msgs);
            return { text: '🔄 Modo alterado para: *ATENDENTE (Cliente)*. Como posso ajudá-lo hoje?', greeting: null };
        }

        if (/(modo funcion[áa]rio|modo assistente|modo admin)/.test(lowerMsg)) {
            const prompt = config.adminPrompt || 'Você é o assistente interno do negócio. Responda de forma direta e prestativa.';
            await setSession(clientId, remoteJid, [{ role: 'system', content: prompt }]);
            return { text: '🔄 Modo alterado para: *FUNCIONÁRIO (Admin)*. O que manda, chefe?', greeting: null };
        }
    }

    // ── Carregar regras dinâmicas para injeção no prompt ──────────────────
    const dynamicRules = await getDynamicRules(clientId);

    // Load or initialize session from Redis
    let chatHistory = await getSession(clientId, remoteJid);
    let greetingToSend = null;

    if (!chatHistory) {
        // Nova sessão — verificar se é bot MANA (AIDA)
        const isAida = config.method?.name === 'MANA';
        let systemPrompt;
        if (isAdmin && config.adminPrompt) {
            systemPrompt = config.adminPrompt;
        } else if (isAida && userProfile) {
            systemPrompt = buildAidaSystemPrompt(config, userProfile);
        } else {
            systemPrompt = getAttendantPrompt(config, dynamicRules, userProfile);
        }
        chatHistory = [{ role: 'system', content: systemPrompt }];

        // Para AIDA: gerar abertura de imersão em vez de greeting padrão
        if (!isAdmin && isAida && userProfile) {
            const openingInstructions = buildImmersionOpeningPrompt(config, userProfile);
            // Gerar primeira cena via LLM (assíncrono dentro da sessão)
            chatHistory.push({ role: 'user', content: openingInstructions });
            try {
                const opening = await chat(chatHistory);
                chatHistory = [{ role: 'system', content: systemPrompt }];
                chatHistory.push({ role: 'assistant', content: opening });
                greetingToSend = opening;
            } catch (e) {
                console.error('[AIDA] Erro ao gerar abertura de imersão:', e.message);
                chatHistory = [{ role: 'system', content: systemPrompt }];
            }
        } else if (!isAdmin && config.attendant?.greeting && !userProfile) {
            const greeting = applyTimeGreeting(config.attendant.greeting);
            chatHistory.push({ role: 'assistant', content: greeting });
            greetingToSend = greeting;
        }
    } else if (!isAdmin && (dynamicRules.length > 0 || userProfile)) {
        // Sessão existente — rebuild do system prompt com regras dinâmicas e/ou perfil de aluno atualizados
        const isAida = config.method?.name === 'MANA';
        if (isAida && userProfile) {
            chatHistory[0] = { role: 'system', content: buildAidaSystemPrompt(config, userProfile) };
        } else {
            chatHistory[0] = { role: 'system', content: getAttendantPrompt(config, dynamicRules, userProfile) };
        }
    }

    // Preparar conteúdo do usuário (suporte a Visão)
    let content;
    if (imageBase64) {
        const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
        content = [
            { type: 'text', text: userMessage && userMessage !== '[MÍDIA IGNORADA]' ? userMessage : 'O cliente enviou esta imagem. Analise-a e responda de acordo com seu papel.' },
            { type: 'image_url', image_url: { url: dataUrl } }
        ];
    } else {
        content = userMessage;
    }

    chatHistory.push({ role: 'user', content });

    // Keep history bounded (max 20 messages + system prompt)
    if (chatHistory.length > 22) {
        chatHistory.splice(1, 2);
    }

    try {
        // Envia para o LLM
        let reply = await chat(chatHistory);

        // ── DETECÇÃO DE RESERVA COMPLETA ──────────────────────────────────────────────
        const reservaMatch = reply.match(/\[RESERVA:\s*([^\]]+)\]/i);
        if (reservaMatch) {
            // Extrai os campos do marcador
            const campos = {};
            reservaMatch[1].split('|').forEach(par => {
                const [chave, ...valor] = par.split('=');
                if (chave) campos[chave.trim().toLowerCase()] = valor.join('=').trim();
            });
            // Remove o marcador da mensagem que o cliente vai ver
            reply = reply.replace(reservaMatch[0], '').trim();
            // Dispara notificação para a gerência (assíncrono, não bloqueia resposta)
            sendReservationNotification(config, campos, remoteJid).catch(e =>
                console.error('[Reserva] Erro não tratado na notificação:', e.message)
            );
        }

        chatHistory.push({ role: 'assistant', content: reply });

        // ── AIDA: Detectar encerramento de sessão + Logar interação ────────────
        const isAida = config.method?.name === 'MANA';
        if (isAida && !isAdmin) {
            await setLastActivity(clientId, remoteJid);
            await logInteraction(clientId, remoteJid, {
                input: userMessage.substring(0, 300),
                output: reply.substring(0, 300),
                profile: userProfile ? { nivel: userProfile.nivel, interesse: userProfile.interesse } : null
            });
            if (detectSessionEnd(userMessage)) {
                console.log(`[AIDA] Sessão encerrada por ${remoteJid}`);
                await setSession(clientId, remoteJid, null);
                return { text: reply + '\n\n_See you next time! 👋 Your progress is saved._', greeting: greetingToSend };
            }
        }

        // Sanitização de Memória: Remover o base64 gigante do histórico antes de salvar no Redis
        const historyToSave = chatHistory.map(msg => {
            if (Array.isArray(msg.content)) {
                return {
                    role: msg.role,
                    content: msg.content.map(c => c.type === 'image_url' ? { type: 'text', text: '[IMAGEM PROCESSADA NESTE TURNO]' } : c)
                };
            }
            return msg;
        });

        // Persist updated session (sem as imagens pesadas)
        await setSession(clientId, remoteJid, historyToSave);

        return { text: reply, greeting: greetingToSend };
    } catch (error) {
        console.error(`[generateResponse - ${clientId}] Erro no pipeline LLM:`, error.message);
        
        // Se era uma mensagem com imagem, dar feedback mais específico
        if (imageBase64) {
            console.error(`[generateResponse - ${clientId}] Falha no pipeline de Visão. Provider de visão esgotado.`);
            return { text: 'Não consegui analisar a imagem agora. Pode descrever o que a foto mostra? Assim consigo te ajudar melhor! 🙏', greeting: null };
        }
        
        return { text: 'Desculpe, estou com uma instabilidade no momento. Pode tentar em breve?', greeting: null };
    }
}

function applyTimeGreeting(greeting) {
    const hour = new Date().getHours();
    let period = 'Bom dia';
    if (hour >= 12 && hour < 18) period = 'Boa tarde';
    else if (hour >= 18) period = 'Boa noite';
    return greeting.replace(/bom dia|boa tarde|boa noite/gi, period);
}

async function transcribeAudio(base64Audio) {
    if (!base64Audio) {
        console.warn('[Whisper] base64Audio é null/undefined — abortando transcrição');
        return null;
    }

    // DEBUG: log do prefixo para diagnóstico
    const preview = base64Audio.substring(0, 120);
    console.log(`[Whisper] base64 preview: ${preview}`);
    console.log(`[Whisper] Tamanho do base64: ${base64Audio.length} chars`);

    try {
        // Split seguro — cobre qualquer variante do prefixo (ogg, ogg;codecs=opus, mp4, etc)
        const base64Data = base64Audio.includes('base64,')
            ? base64Audio.split('base64,')[1]
            : base64Audio;

        const buffer = Buffer.from(base64Data, 'base64');
        console.log(`[Whisper] Buffer gerado: ${buffer.length} bytes`);

        if (buffer.length < 1000) {
            console.warn('[Whisper] Buffer muito pequeno — possível base64 corrompido');
            return null;
        }

        // Detecta extensão pelo prefixo MIME
        let ext = 'ogg';
        if (base64Audio.includes('audio/mp4')) ext = 'mp4';
        else if (base64Audio.includes('audio/mpeg')) ext = 'mp3';
        else if (base64Audio.includes('audio/wav')) ext = 'wav';

        const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.${ext}`);
        fs.writeFileSync(tempFilePath, buffer);

        console.log(`[Whisper] Enviando para transcrição: ${tempFilePath} (${ext})`);

        let transcription = null;
        let groqSuccess = false;

        // 1. Tentar Groq (Whisper) com rotação total das chaves
        const keysConfig = require('../config/keys.json');
        const groqMaxAttempts = keysConfig.groq ? keysConfig.groq.length : 3;
        let currentGroqKey = apiRouter.getKey('groq');

        for (let i = 0; i < groqMaxAttempts; i++) {
            if (!currentGroqKey) break;
            try {
                const groqClient = new Groq({ apiKey: currentGroqKey });
                transcription = await groqClient.audio.transcriptions.create({
                    file: fs.createReadStream(tempFilePath),
                    model: 'whisper-large-v3',
                    language: 'pt',
                });
                groqSuccess = true;
                break; 
            } catch (err) {
                console.warn(`[Whisper-Groq] Falha na chave: ${err.message} — Rotacionando...`);
                currentGroqKey = apiRouter.rotateKey('groq');
            }
        }

        // 2. Fallback para Gemini 1.5 Flash (Visão/Áudio) caso Groq caia totalmente
        if (!groqSuccess) {
            console.warn('[Whisper-Fallback] Groq falhou. Acionando Gemini 1.5 Flash para transcrição de áudio...');
            const geminiMaxAttempts = keysConfig.gemini ? keysConfig.gemini.length : 3;
            let currentGeminiKey = apiRouter.getKey('gemini');
            const axios = require('axios'); // Garantir axios
            
            for (let i = 0; i < geminiMaxAttempts; i++) {
                if (!currentGeminiKey) break;
                try {
                    const base64AudioData = fs.readFileSync(tempFilePath).toString("base64");
                    
                    let mimeType = 'audio/ogg';
                    if (ext === 'mp4') mimeType = 'audio/mp4';
                    else if (ext === 'mp3') mimeType = 'audio/mp3';
                    else if (ext === 'wav') mimeType = 'audio/wav';

                    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${currentGeminiKey}`;
                    const response = await axios.post(geminiUrl, {
                        contents: [{
                            parts: [
                                { text: "Por favor, transcreva exatamente o que é dito neste áudio em português. Não adicione nenhum comentário, markdown ou tradução. Apenas a transcrição em texto puro:" },
                                {
                                    inlineData: {
                                        mimeType: mimeType,
                                        data: base64AudioData
                                    }
                                }
                            ]
                        }]
                    }, { timeout: 30000 });

                    const textoGerado = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (textoGerado) {
                        transcription = { text: textoGerado.trim() };
                        break; // Sucesso
                    }
                } catch (err) {
                    const status = err.response ? err.response.status : 'Unknown';
                    console.warn(`[Whisper-Fallback] Falha na chave Gemini (${status}): ${err.message} — Rotacionando...`);
                    currentGeminiKey = apiRouter.rotateKey('gemini');
                }
            }
        }

        fs.unlinkSync(tempFilePath);

        if (!transcription || !transcription.text) {
            console.error('[Whisper] Todas as tentativas de transcrição (Groq e Gemini) falharam.');
            return null;
        }

        console.log(`[Whisper] Transcrição concluída: "${transcription.text}"`);
        return transcription.text;
    } catch (error) {
        console.error('[Whisper] Erro na transcrição:', error.message);
        if (error.response) {
            console.error('[Whisper] Response status:', error.response.status);
            console.error('[Whisper] Response data:', JSON.stringify(error.response.data));
        }
        return null;
    }
}

module.exports = { generateResponse, transcribeAudio };
