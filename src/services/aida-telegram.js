/**
 * AIDA — Telegram Bot Handler (Core Engine)
 * Aquisição Imersiva Dinâmica Acelerada
 * 
 * Arquitetura:
 * Telegram Bot API → Este handler → Groq LLM → PostgreSQL
 * 
 * Dex (Dev) — Experia Solutions
 */

const { Telegraf } = require('telegraf');
const { createReadStream } = require('fs');
const { chat } = require('./llm');
const db = require('./aida-db');
const { generateVoiceMessage, cleanupTempFile } = require('./aida-tts');
const {
    buildImmersionPrompt,
    buildQuestionPrompt,
    detectQuestionMode,
    detectImmersionMode,
    buildIcebreakerInstructions,
    TUTOR_PERSONAS,
} = require('./aida-prompt');

const aida = new Telegraf(process.env.AIDA_TELEGRAM_TOKEN);

// ── Config do cliente AIDA (para reutilizar o serviço Groq existente) ─────────
const aidaConfig = require('../config/clients/aida.json');

// ── ONBOARDING FLOW ───────────────────────────────────────────────────────────

const ONBOARDING_QUESTIONS = aidaConfig.onboarding.questions;

async function handleOnboarding(ctx, student, state) {
    const telegramId = ctx.from.id;
    const text = ctx.message?.text || '';

    // Step 0 → Mostrar boas-vindas e primeira pergunta
    if (!state || state.step_atual === 0) {
        await db.updateOnboardingStep(telegramId, 1, {});
        await ctx.reply(aidaConfig.onboarding.welcomeMessage, {
            reply_markup: {
                inline_keyboard: ONBOARDING_QUESTIONS[0].options.map(opt => ([
                    { text: opt.label, callback_data: `onb_1_${opt.value}` }
                ]))
            }
        });
        return;
    }

    // Steps 1-5 são tratados via callback_query (botões inline)
    // Este branch é para texto livre durante onboarding
    const step = state.step_atual;
    if (step <= 5) {
        const q = ONBOARDING_QUESTIONS[step - 1];
        await ctx.reply(`Por favor, use os botões abaixo para responder 👇`, {
            reply_markup: {
                inline_keyboard: q.options.map(opt => ([
                    { text: opt.label, callback_data: `onb_${step}_${opt.value}` }
                ]))
            }
        });
    }
}

aida.action(/^onb_(\d+)_(.+)$/, async (ctx) => {
    const telegramId = ctx.from.id;
    const step = parseInt(ctx.match[1]);
    const value = ctx.match[2];

    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

    const state = await db.getOnboardingState(telegramId);
    const respostas = state?.respostas || {};
    const questionId = ONBOARDING_QUESTIONS[step - 1]?.id;

    if (questionId) respostas[questionId] = value;

    if (step < 5) {
        // Próxima pergunta
        await db.updateOnboardingStep(telegramId, step + 1, respostas);
        const nextQ = ONBOARDING_QUESTIONS[step];
        await ctx.reply(nextQ.text, {
            reply_markup: {
                inline_keyboard: nextQ.options.map(opt => ([
                    { text: opt.label, callback_data: `onb_${step + 1}_${opt.value}` }
                ]))
            }
        });
    } else {
        // Onboarding completo — criar perfil do aluno
        await db.updateOnboardingStep(telegramId, 5, respostas);
        await db.completeOnboarding(telegramId);

        const tutorNome = TUTOR_PERSONAS[respostas.interesse]?.name || 'Jamie';

        await db.updateStudentProfile(telegramId, {
            nivel_numerico: parseInt(respostas.nivel) || 3,
            interesse: respostas.interesse || 'general',
            objetivo: respostas.objetivo || 'general',
            disponibilidade: parseInt(respostas.disponibilidade) || 15,
            tom: respostas.tom || 'neutral',
            tutor_nome: tutorNome,
        });

        await ctx.reply(
            `${aidaConfig.onboarding.completionMessage}\n\nSeu tutor é o *${tutorNome}* 🎯`,
            { parse_mode: 'Markdown' }
        );

        // Iniciar primeira cena imediatamente
        setTimeout(() => startFirstScene(ctx, telegramId), 1500);
    }
});

async function startFirstScene(ctx, telegramId) {
    const student = await db.getStudent(telegramId);
    if (!student) return;

    const systemPrompt = buildImmersionPrompt(student, []);
    const icebreaker = buildIcebreakerInstructions(student);

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `[SYSTEM: ${icebreaker}]` },
    ];

    try {
        const reply = await chat(messages, aidaConfig);
        const cleanReply = reply.trim();

        // Salvar na sessão e no log
        messages.push({ role: 'assistant', content: cleanReply });
        await db.upsertSession(telegramId, messages, 'icebreaker', null);
        await db.logMessage(telegramId, 'assistant', cleanReply, {
            cenaTipo: 'icebreaker',
            faseMomento: student.fase,
            nivelMomento: student.nivel_numerico,
        });

        // Enviar texto
        await ctx.reply(cleanReply);

        // Enviar voz (listening training) — não bloqueia se falhar
        const voiceFile = await generateVoiceMessage(cleanReply, student.interesse);
        if (voiceFile) {
            await ctx.sendAudio({ source: createReadStream(voiceFile) });
            cleanupTempFile(voiceFile);
        }
    } catch (err) {
        console.error('[AIDA] Erro no icebreaker:', err.message);
        await ctx.reply('Hey! Ready to start? 🚀 Tell me — what\'s something you\'ve been thinking about lately related to your interests?');
    }
}

// ── CORE MESSAGE HANDLER ──────────────────────────────────────────────────────

aida.on('message', async (ctx) => {
    const telegramId = ctx.from.id;
    let text = ctx.message?.text || '';
    const nome = ctx.from.first_name || 'Student';

    // ── PROCESSAMENTO DE ÁUDIO (Voice Notes) ──────────────────────────────
    if (ctx.message?.voice) {
        try {
            await ctx.sendChatAction('typing');
            const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
            const axios = require('axios');
            const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
            const base64Audio = Buffer.from(response.data).toString('base64');
            const { transcribeAudio } = require('./groq');
            
            const transcricao = await transcribeAudio(`data:audio/ogg;base64,${base64Audio}`);
            if (transcricao) {
                text = `[ÁUDIO TRANSCRITO] ${transcricao}`;
                // Opcional: ecoar a transcrição para o usuário saber que o bot entendeu (opcional, omitido para naturalidade)
            } else {
                await ctx.reply('Sorry, I couldn\'t hear that clearly. Could you say it again or type it?');
                return;
            }
        } catch (err) {
            console.error('[AIDA] Erro ao baixar/transcrever áudio:', err.message);
            await ctx.reply('Ops, my ears are acting up! Could you type that for me?');
            return;
        }
    }

    // Ignorar comandos puros (tratados separadamente) ou mensagens vazias não-áudio
    if (text.startsWith('/') || !text.trim()) return;

    try {
        // Verificar ou criar aluno
        let student = await db.getStudent(telegramId);
        if (!student) {
            student = await db.createStudent(telegramId, nome);
        }

        // Verificar status do aluno
        if (student.status === 'encerrado') {
            await ctx.reply('Sua conta está encerrada. Entre em contato com o suporte.');
            return;
        }

        if (student.status === 'pausado' && student.pausa_ate && new Date(student.pausa_ate) > new Date()) {
            const dataRetorno = new Date(student.pausa_ate).toLocaleDateString('pt-BR');
            await ctx.reply(`Você está em pausa até ${dataRetorno}. Até lá! 👋`);
            return;
        }

        // Onboarding não completo
        const onboardingState = await db.getOnboardingState(telegramId);
        if (!student.onboarding_completo || !onboardingState?.completo) {
            await handleOnboarding(ctx, student, onboardingState);
            return;
        }

        // ── Detecção de modo ──────────────────────────────────────────────────
        const wantsQuestion = detectQuestionMode(text);
        const wantsImmersion = detectImmersionMode(text);

        if (wantsImmersion && student.modo_atual === 'duvida') {
            await db.updateStudentMode(telegramId, 'imersao');
            student = { ...student, modo_atual: 'imersao' };
        } else if (wantsQuestion && student.modo_atual === 'imersao') {
            await db.updateStudentMode(telegramId, 'duvida');
            student = { ...student, modo_atual: 'duvida' };
        }

        // ── Carregar sessão e memória de aquisição ────────────────────────────
        const sessionData = await db.getSession(telegramId);
        const acquisitionMemory = await db.getAcquisitionMemory(telegramId);

        // ── Construir system prompt conforme modo ─────────────────────────────
        const systemPrompt = student.modo_atual === 'duvida'
            ? buildQuestionPrompt(student)
            : buildImmersionPrompt(student, acquisitionMemory);

        let chatHistory;
        if (sessionData?.chatHistory && sessionData.chatHistory.length > 0) {
            // Sessão existente — atualizar apenas o system prompt
            chatHistory = [
                { role: 'system', content: systemPrompt },
                ...sessionData.chatHistory.slice(1), // mantém histórico, troca system
            ];
        } else {
            // Nova sessão
            chatHistory = [{ role: 'system', content: systemPrompt }];
        }

        // Log da mensagem do usuário
        await db.logMessage(telegramId, 'user', text, {
            cenaTipo: sessionData?.cenaTipo,
            faseMomento: student.fase,
            nivelMomento: student.nivel_numerico,
        });

        // Adicionar mensagem do usuário ao histórico
        chatHistory.push({ role: 'user', content: text });

        // ── Chamar LLM ────────────────────────────────────────────────────────
        const typingAction = ctx.sendChatAction('typing');
        const reply = await chat(chatHistory, aidaConfig);
        const cleanReply = reply.trim();

        // ── Persistir resposta ────────────────────────────────────────────────
        chatHistory.push({ role: 'assistant', content: cleanReply });

        await db.upsertSession(
            telegramId,
            chatHistory,
            sessionData?.cenaTipo || 'situacao_real',
            sessionData?.cenaContexto
        );

        await db.logMessage(telegramId, 'assistant', cleanReply, {
            cenaTipo: sessionData?.cenaTipo,
            faseMomento: student.fase,
            nivelMomento: student.nivel_numerico,
        });

        // Atualizar último acesso
        await db.updateStudentAccess(telegramId);

        // ── Calibração de nível automática (assíncrona, não bloqueia) ────────
        calibrateLevelAsync(telegramId, student).catch(err =>
            console.error('[AIDA] Erro na calibração:', err.message)
        );

        // Enviar texto
        await ctx.reply(cleanReply);

        // Enviar voz para treino de listening (assíncrono, não bloqueia fluxo)
        generateVoiceMessage(cleanReply, student.interesse)
            .then(voiceFile => {
                if (voiceFile) {
                    return ctx.sendAudio({ source: createReadStream(voiceFile) })
                        .then(() => cleanupTempFile(voiceFile));
                }
            })
            .catch(err => console.error('[AIDA-TTS] Erro ao enviar voz:', err.message));

    } catch (err) {
        console.error('[AIDA] Erro crítico no handler:', err.message, err.stack);
        await ctx.reply('Something went wrong on my end. Give me a sec and try again!');
    }
});

// ── COMANDOS DO ALUNO ──────────────────────────────────────────────────────────

aida.command('start', async (ctx) => {
    const telegramId = ctx.from.id;
    const nome = ctx.from.first_name || 'Student';

    let student = await db.getStudent(telegramId);
    if (!student) {
        student = await db.createStudent(telegramId, nome);
    }

    const onboardingState = await db.getOnboardingState(telegramId);

    if (!student.onboarding_completo || !onboardingState?.completo) {
        await handleOnboarding(ctx, student, null);
    } else {
        await ctx.reply(`Welcome back! Ready for a new scene? Just send me a message and we'll dive in 🚀`);
    }
});

aida.command('perfil', async (ctx) => {
    const telegramId = ctx.from.id;
    const student = await db.getStudent(telegramId);
    if (!student) return ctx.reply('Perfil não encontrado. Use /start para começar.');

    const summary = await db.getAcquisitionSummary(telegramId);
    const tutor = TUTOR_PERSONAS[student.interesse];

    await ctx.reply(
        `📊 *Seu Perfil AIDA*\n\n` +
        `👤 Tutor: ${tutor?.name || 'Jamie'}\n` +
        `📈 Nível: ${student.nivel_numerico}/10\n` +
        `🎯 Fase: ${student.fase}\n` +
        `📚 Sessões: ${student.sessoes_total}\n\n` +
        `🧠 *Memória de Aquisição:*\n` +
        `✅ Adquiridas: ${summary?.adquiridas || 0}\n` +
        `🔄 Em Processo: ${summary?.em_processo || 0}\n` +
        `🆕 Novas: ${summary?.novas || 0}\n` +
        `📊 ${summary?.pct_adquiridas || 0}% das estruturas praticadas já são suas`,
        { parse_mode: 'Markdown' }
    );
});

aida.command('cena', async (ctx) => {
    const telegramId = ctx.from.id;
    await db.clearSession(telegramId);
    await db.updateStudentMode(telegramId, 'imersao');
    const student = await db.getStudent(telegramId);
    if (student) {
        await ctx.reply('New scene loading... 🎬');
        await startFirstScene(ctx, telegramId);
    }
});

aida.command('pausa', async (ctx) => {
    await ctx.reply('Para pausar suas sessões, entre em contato com seu tutor humano.');
});

// ── COMANDOS ADMIN DO GABRIEL ──────────────────────────────────────────────────

function isAdmin(telegramId) {
    const admins = (process.env.AIDA_ADMIN_IDS || '').split(',').map(id => parseInt(id.trim()));
    return admins.includes(parseInt(telegramId));
}

aida.command('status', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;

    const students = await db.getAllActiveStudents();
    if (students.length === 0) {
        return ctx.reply('Nenhum aluno ativo no momento.');
    }

    const lines = students.map(s =>
        `${s.saude_flag} *${s.nome || 'N/A'}* (${s.nivel_numerico}/10) — ${s.fase} — ${s.dias_sem_acesso}d atrás`
    );

    await ctx.reply(
        `📊 *Painel AIDA — ${students.length} aluno(s) ativo(s)*\n\n${lines.join('\n')}`,
        { parse_mode: 'Markdown' }
    );
});

// ── CALIBRAÇÃO DE NÍVEL (Assíncrona) ─────────────────────────────────────────

async function calibrateLevelAsync(telegramId, student) {
    const avgWords = await db.getAverageWordCount(telegramId, 5);
    const currentLevel = student.nivel_numerico;

    // Nível sobe: média > 15 palavras = aluno fluindo
    if (avgWords > 15 && currentLevel < 10) {
        // Verificar se houve 5 sessões recentes assim
        // (simplificado: usa threshold direto por ora)
        if (avgWords > 20 && currentLevel < 9) {
            await db.updateStudentLevel(telegramId, currentLevel + 1);
            console.log(`[AIDA] Nível elevado: ${telegramId} → ${currentLevel + 1}`);
        }
    }

    // Nível cai: média < 3 palavras = aluno travado
    if (avgWords < 3 && avgWords > 0 && currentLevel > 1) {
        await db.updateStudentLevel(telegramId, currentLevel - 1);
        console.log(`[AIDA] Nível reduzido: ${telegramId} → ${currentLevel - 1}`);
    }
}

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────

async function getAidaBotInfo() {
    try {
        const me = await aida.telegram.getMe();
        return { ok: true, username: me.username, id: me.id };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

module.exports = { aida, getAidaBotInfo };
