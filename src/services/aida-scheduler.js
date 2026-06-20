/**
 * AIDA Daily Immersion Scheduler (Story 1.3)
 * Envia a cena de imersão diária para todos os alunos ativos.
 *
 * Usa node-cron para disparar no horário configurado por aluno.
 * Fallback: hora padrão configurável via env AIDA_DAILY_HOUR (default: 8h)
 *
 * Para habilitar: chamar startAidaScheduler(app, clients) no index.js
 */

const cron = require('node-cron');
const { getOnboardingState, clearSession, getLastActivity } = require('./redis');
const { buildAidaSystemPrompt, buildImmersionOpeningPrompt, selectTutorPersona } = require('./aida-engine');
const { chat } = require('./llm');

const AIDA_CLIENT_ID = 'aida';
const DAILY_HOUR = parseInt(process.env.AIDA_DAILY_HOUR || '8', 10);
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos

/**
 * Envia uma mensagem via Evolution API (wrapper simples).
 */
async function sendToStudent(jid, text, config) {
    const evolutionUrl = process.env.EVOLUTION_API_URL || 'https://evolution-api-production-9afd.up.railway.app';
    const { instanceName, instanceApiKey } = config;

    if (!instanceName || !instanceApiKey) {
        console.warn('[AIDA Scheduler] instanceName/instanceApiKey não configurados — skip send');
        return;
    }

    try {
        const res = await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
            method: 'POST',
            headers: { 'apikey': instanceApiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: jid.replace('@s.whatsapp.net', ''), text })
        });
        if (!res.ok) {
            const err = await res.text();
            console.error(`[AIDA Scheduler] Falha ao enviar para ${jid}: ${err}`);
        }
    } catch (e) {
        console.error(`[AIDA Scheduler] Erro de rede ao enviar para ${jid}: ${e.message}`);
    }
}

/**
 * Gera e envia a cena de imersão diária para um aluno.
 */
async function sendDailyImmersion(jid, profile, config) {
    console.log(`[AIDA Scheduler] Enviando cena diária para ${jid} (nível: ${profile.nivel}, interesse: ${profile.interesse})`);

    const systemPrompt = buildAidaSystemPrompt(config, profile);
    const openingInstructions = buildImmersionOpeningPrompt(config, profile);

    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: openingInstructions }
    ];

    try {
        const scene = await chat(messages);
        // Limpar sessão anterior para começar fresca com nova cena
        await clearSession(AIDA_CLIENT_ID, jid);

        const intro = `*Good ${getDayPeriod()}!* ☀️ Here's your daily immersion scene:\n\n`;
        await sendToStudent(jid, intro + scene, config);
        console.log(`[AIDA Scheduler] ✅ Cena enviada para ${jid}`);
    } catch (e) {
        console.error(`[AIDA Scheduler] Erro ao gerar cena para ${jid}: ${e.message}`);
    }
}

function getDayPeriod() {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 18) return 'afternoon';
    return 'evening';
}

/**
 * Carrega todos os JIDs com onboarding completo do Redis.
 * Nota: Para produção, usar um índice de alunos dedicado.
 * No MVP, o admin pode forçar disparo via comando.
 */
async function getActiveStudentJids(config) {
    // MVP: lista de alunos ativos a ser gerenciada via comando admin
    // O admin adiciona/remove alunos via comando no WhatsApp
    const activeStudentsKey = process.env.AIDA_ACTIVE_STUDENTS || '';
    if (!activeStudentsKey) return [];

    // Parse "55119XXXXXXXX,55119YYYYYYY" → ["55119XXXXXXXX@s.whatsapp.net", ...]
    return activeStudentsKey
        .split(',')
        .map(n => n.trim())
        .filter(Boolean)
        .map(n => n.includes('@') ? n : `${n}@s.whatsapp.net`);
}

/**
 * Inicia o scheduler de imersão diária.
 * Dispara todo dia na hora configurada.
 */
function startAidaScheduler(config) {
    const cronExpr = `0 ${DAILY_HOUR} * * *`; // ex: "0 8 * * *" = 8h todo dia

    console.log(`[AIDA Scheduler] Iniciando scheduler — disparo diário às ${DAILY_HOUR}h (${cronExpr})`);

    cron.schedule(cronExpr, async () => {
        console.log('[AIDA Scheduler] 🔔 Disparando cenas diárias...');
        try {
            const jids = await getActiveStudentJids(config);
            if (jids.length === 0) {
                console.log('[AIDA Scheduler] Nenhum aluno ativo configurado. Adicione via AIDA_ACTIVE_STUDENTS ou comando admin.');
                return;
            }

            for (const jid of jids) {
                const state = await getOnboardingState(AIDA_CLIENT_ID, jid);
                if (!state || !state.completedAt) {
                    console.log(`[AIDA Scheduler] ${jid} não completou onboarding — skip`);
                    continue;
                }
                await sendDailyImmersion(jid, state.profile, config);
                // Pausa entre envios para evitar rate-limit da Evolution API
                await new Promise(r => setTimeout(r, 2000));
            }
            console.log('[AIDA Scheduler] ✅ Cenas diárias enviadas.');
        } catch (e) {
            console.error('[AIDA Scheduler] Erro crítico no scheduler:', e.message);
        }
    }, {
        timezone: 'America/Sao_Paulo'
    });
}

/**
 * Disparo manual de cena para um aluno específico (via comando admin).
 */
async function triggerManualScene(jid, config) {
    const state = await getOnboardingState(AIDA_CLIENT_ID, jid);
    if (!state || !state.completedAt || !state.profile) {
        return `⚠️ Aluno ${jid} não completou o onboarding.`;
    }
    await sendDailyImmersion(jid, state.profile, config);
    return `✅ Cena enviada para ${jid}`;
}

module.exports = { startAidaScheduler, triggerManualScene, sendDailyImmersion };
