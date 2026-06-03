require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { generateResponse, transcribeAudio } = require('./services/groq');
const { sendMessage, getMediaBase64 } = require('./services/evolution');
const { isSessionPaused, pauseSession, resumeSession, clearSession } = require('./services/redis');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const BUILD_VERSION = '3.0.0';
const BUILD_DATE = '2026-06-03T14:30:00Z';

// Keywords que ativam o handoff humano
const HANDOFF_KEYWORDS = [
    'falar com atendente',
    'falar com humano',
    'falar com pessoa',
    'quero um atendente',
    'quero um humano',
    'atendente real',
    'pessoa real',
    'chamar o paulo',
    'falar com o paulo',
];

function loadClientConfig(clientId) {
    const configPath = path.join(__dirname, 'config', 'clients', `${clientId}.json`);
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    return null;
}

function detectHandoff(text) {
    const lower = text.toLowerCase();
    return HANDOFF_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyAdmin(clientId, config, customerJid) {
    if (!config.adminNumbers || config.adminNumbers.length === 0) return;

    const adminJid = config.adminNumbers[0]; // notifica o primeiro admin
    const msg = `🔔 *Handoff solicitado!*\nUm cliente quer falar com você.\n\nContato: ${customerJid}\n\nResponda ao cliente diretamente ou use:\n*retomar ${customerJid}*\npara reativar o bot nessa conversa.`;

    try {
        await sendMessage(clientId, adminJid, msg, config);
        console.log(`[Handoff] Admin notificado: ${adminJid}`);
    } catch (err) {
        console.error('[Handoff] Falha ao notificar admin:', err.message);
    }
}

// ─── Webhook Handler ───────────────────────────────────────────────────────────
async function handleWebhook(req, res) {
    const body = req.body;

    // Bloquear grupos, status e self-messages imediatamente
    const rawJid = body?.data?.key?.remoteJid || '';
    const isGroup = rawJid.endsWith('@g.us') || rawJid.includes('@g.us');
    const isStatus = rawJid === 'status@broadcast';
    const isFromMe = body?.data?.key?.fromMe === true;

    if (isGroup || isStatus || isFromMe) {
        return res.status(200).send('Ignored');
    }

    console.log(`[Webhook] clientId: ${req.params.clientId}, jid: ${rawJid}`);

    try {
        const { clientId } = req.params;
        const config = loadClientConfig(clientId);

        if (!config) {
            console.error(`[Webhook] Config não encontrada: ${clientId}`);
            return res.status(404).send('Client config not found');
        }

        if (!body?.data?.message) {
            return res.status(200).send('Event ignored');
        }

        const msgData = body.data;
        const remoteJid = msgData.key.remoteJid;

        // ── Admin detection ──────────────────────────────────────────────────
        let isAdmin = false;
        if (config.adminNumbers) {
            const remoteDigits = remoteJid.replace(/\D/g, '');
            isAdmin = config.adminNumbers.some(adminNum => {
                const adminDigits = adminNum.replace(/\D/g, '');
                return remoteDigits.endsWith(adminDigits.slice(-8));
            });
        }

        // ── Handoff: verificar pausa da sessão (não se aplica a admins) ──────
        if (!isAdmin) {
            const paused = await isSessionPaused(clientId, remoteJid);
            if (paused) {
                console.log(`[Handoff] Sessão pausada para ${remoteJid} — bot silenciado`);
                return res.status(200).send('Session paused');
            }
        }

        // ── Processar mensagem de Admin: comandos de retomada ────────────────
        if (isAdmin) {
            const rawText = msgData.message?.conversation || msgData.message?.extendedTextMessage?.text || '';
            const retomadaMatch = rawText.match(/retomar\s+([\d@\w.]+)/i);
            if (retomadaMatch) {
                const targetJid = retomadaMatch[1].includes('@') ? retomadaMatch[1] : `${retomadaMatch[1]}@s.whatsapp.net`;
                await resumeSession(clientId, targetJid);
                await sendMessage(clientId, remoteJid, `✅ Bot reativado para: ${targetJid}`, config);
                return res.status(200).send('OK');
            }
        }

        // ── Extrair texto / transcrever áudio ────────────────────────────────
        const message = msgData.message;
        let text = '';

        if (message.conversation) {
            text = message.conversation;
        } else if (message.extendedTextMessage?.text) {
            text = message.extendedTextMessage.text;
        } else if (message.audioMessage) {
            console.log(`[Audio] Recebido de ${remoteJid} — iniciando pipeline de transcrição`);

            let base64 = message.audioMessage.base64;

            if (!base64) {
                console.log('[Audio] base64 inline ausente — buscando via API Evolution...');
                base64 = await getMediaBase64(clientId, msgData, config);
            }

            if (!base64) {
                console.warn(`[Audio] Falha ao obter base64 de ${remoteJid}`);
                await sendMessage(clientId, remoteJid, '⚠️ Não consegui baixar o áudio. Pode enviar por texto?', config);
                return res.status(200).send('Audio download failed');
            }

            const transcript = await transcribeAudio(base64);

            if (!transcript) {
                console.warn(`[Audio] Falha na transcrição de ${remoteJid}`);
                await sendMessage(clientId, remoteJid, '⚠️ Não entendi o áudio. Pode tentar novamente ou enviar por texto?', config);
                return res.status(200).send('Transcription failed');
            }

            text = transcript;
            console.log(`[Audio] Transcrição: "${transcript}"`);
        } else if (message.imageMessage || message.videoMessage || message.documentMessage) {
            text = '[MÍDIA IGNORADA]';
        }

        if (!text) {
            return res.status(200).send('No text');
        }

        console.log(`[${clientId.toUpperCase()}] De ${remoteJid} (Admin: ${isAdmin}): ${text}`);

        // ── Detectar handoff ANTES de enviar para o LLM ──────────────────────
        if (!isAdmin && detectHandoff(text)) {
            console.log(`[Handoff] Keyword detectada de ${remoteJid}`);
            await pauseSession(clientId, remoteJid);
            await notifyAdmin(clientId, config, remoteJid);
            await sendMessage(
                clientId,
                remoteJid,
                '👤 Vou chamar o atendente humano agora. Aguarde um momento!',
                config
            );
            return res.status(200).send('Handoff triggered');
        }

        // ── Gerar resposta via LLM ───────────────────────────────────────────
        const responseObj = await generateResponse(clientId, config, remoteJid, text, isAdmin);
        const replyText = typeof responseObj === 'string' ? responseObj : responseObj?.text;
        const greetingToSend = typeof responseObj === 'string' ? null : responseObj?.greeting;

        // Enviar saudação inicial se for primeira interação
        if (greetingToSend) {
            await sendMessage(clientId, remoteJid, greetingToSend, config);
            console.log(`[${clientId.toUpperCase()}] Greeting enviado para ${remoteJid}`);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        if (replyText) {
            await sendMessage(clientId, remoteJid, replyText, config);
            console.log(`[${clientId.toUpperCase()}] Resposta enviada para ${remoteJid}`);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('[Webhook] Erro crítico:', error.message, error.stack);
        res.status(500).send('Internal Server Error');
    }
}

// ─── Rotas ─────────────────────────────────────────────────────────────────────
app.post('/api/webhook/:clientId', handleWebhook);
app.post('/api/webhook/:clientId/:event', handleWebhook);

// Admin: forçar retomada via HTTP (alternativa ao comando WhatsApp)
app.post('/api/admin/:clientId/resume/:jid', async (req, res) => {
    const { clientId, jid } = req.params;
    const decodedJid = decodeURIComponent(jid);
    await resumeSession(clientId, decodedJid);
    console.log(`[Admin API] Sessão retomada: ${clientId} / ${decodedJid}`);
    res.status(200).json({ ok: true, message: `Sessão retomada para ${decodedJid}` });
});

// Admin: limpar sessão (forçar reinício de conversa)
app.post('/api/admin/:clientId/clear/:jid', async (req, res) => {
    const { clientId, jid } = req.params;
    const decodedJid = decodeURIComponent(jid);
    await clearSession(clientId, decodedJid);
    await resumeSession(clientId, decodedJid);
    console.log(`[Admin API] Sessão limpa: ${clientId} / ${decodedJid}`);
    res.status(200).json({ ok: true, message: `Sessão limpa para ${decodedJid}` });
});

app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/version', (req, res) => res.json({ version: BUILD_VERSION, buildDate: BUILD_DATE, status: 'running' }));

app.listen(PORT, () => {
    console.log(`🚀 KAIROS Commercial Bots v${BUILD_VERSION} running on port ${PORT}`);
});
