require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { generateResponse, transcribeAudio } = require('./services/groq');
const { sendMessage, getMediaBase64 } = require('./services/evolution');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const BUILD_VERSION = '2.3.0';
const BUILD_DATE = '2026-06-03T13:35:00Z';

// Load client config
function loadClientConfig(clientId) {
    const configPath = path.join(__dirname, 'config', 'clients', `${clientId}.json`);
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    return null;
}

// Webhook handler logic
async function handleWebhook(req, res) {
    const body = req.body;

    // ===== FIRST LINE OF DEFENSE: Block groups IMMEDIATELY =====
    // Check raw body for ANY group indicator before doing anything else
    const rawJid = body?.data?.key?.remoteJid || '';
    const isGroup = rawJid.endsWith('@g.us') || rawJid.includes('@g.us');
    const isStatus = rawJid === 'status@broadcast';
    const isFromMe = body?.data?.key?.fromMe === true;
    
    if (isGroup || isStatus || isFromMe) {
        console.log(`[BLOCKED] Group/Status/Self message from ${rawJid} — ignoring`);
        return res.status(200).send('Ignored');
    }
    // ===== END FIRST LINE OF DEFENSE =====

    console.log(`[Webhook Hit] clientId: ${req.params.clientId}, jid: ${rawJid}`);

    try {
        const { clientId } = req.params;
        const config = loadClientConfig(clientId);

        if (!config) {
            console.error(`[Webhook] Config not found for client: ${clientId}`);
            return res.status(404).send('Client config not found');
        }
        
        // Evolution API validation
        if (!body || !body.data || !body.data.message) {
            return res.status(200).send('Event ignored');
        }

        const msgData = body.data;
        const remoteJid = msgData.key.remoteJid;

        // Admin detection
        let isAdmin = false;
        if (config.adminNumbers) {
            const remoteDigits = remoteJid.replace(/\D/g, '');
            isAdmin = config.adminNumbers.some(adminNum => {
                const adminDigits = adminNum.replace(/\D/g, '');
                // Compara os últimos 8 dígitos para evitar bug do 9º dígito
                return remoteDigits.endsWith(adminDigits.slice(-8));
            });
        }

        // Get message text
        const message = msgData.message;
        let text = "";
        
        if (message.conversation) {
            text = message.conversation;
        } else if (message.extendedTextMessage?.text) {
            text = message.extendedTextMessage.text;
        } else if (message.audioMessage) {
            console.log(`[${clientId.toUpperCase()}] Áudio recebido de ${remoteJid}, iniciando transcrição...`);
            
            // 1. Try to get base64 directly if Evolution sent it
            let base64 = message.audioMessage.base64;
            
            // 2. Fallback to API if not present
            if (!base64) {
                base64 = await getMediaBase64(clientId, msgData);
            }
            
            if (!base64) {
                // Cannot download audio — warn user directly, skip LLM
                console.warn(`[${clientId.toUpperCase()}] Falha ao obter base64 do áudio de ${remoteJid}`);
                await sendMessage(clientId, remoteJid, '⚠️ Não consegui baixar o seu áudio. Pode enviar uma mensagem de texto?');
                return res.status(200).send('Audio download failed');
            }

            const transcript = await transcribeAudio(base64);
            if (!transcript) {
                // Transcription failed — warn user directly, skip LLM
                console.warn(`[${clientId.toUpperCase()}] Falha na transcrição do áudio de ${remoteJid}`);
                await sendMessage(clientId, remoteJid, '⚠️ Não consegui entender o áudio. Pode tentar novamente ou enviar por texto?');
                return res.status(200).send('Transcription failed');
            }

            text = transcript;
            console.log(`[${clientId.toUpperCase()}] Transcrição: ${transcript}`);
        } else if (message.imageMessage || message.videoMessage || message.documentMessage) {
            text = "[MÍDIA IGNORADA]";
        }

        if (!text) {
            return res.status(200).send('No text');
        }

        console.log(`[${clientId.toUpperCase()}] Mensagem recebida de ${remoteJid} (Admin: ${isAdmin}): ${text}`);

        // Generate response via Groq
        const responseObj = await generateResponse(clientId, config, remoteJid, text, isAdmin);
        const replyText = typeof responseObj === 'string' ? responseObj : responseObj?.text;
        const greetingToSend = typeof responseObj === 'string' ? null : responseObj?.greeting;

        // Send greeting first if present (first interaction)
        if (greetingToSend) {
            await sendMessage(clientId, remoteJid, greetingToSend);
            console.log(`[${clientId.toUpperCase()}] Greeting enviado para ${remoteJid}`);
            // Add a small delay to make it natural
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        // Send main response via Evolution
        if (replyText) {
            await sendMessage(clientId, remoteJid, replyText);
            console.log(`[${clientId.toUpperCase()}] Resposta enviada para ${remoteJid}`);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('[Webhook] Error processing request:', error);
        res.status(500).send('Internal Server Error');
    }
}

// Multi-tenant webhook endpoints
app.post('/api/webhook/:clientId', handleWebhook);
app.post('/api/webhook/:clientId/:event', handleWebhook);

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Version check — verify which code is actually running
app.get('/version', (req, res) => {
    res.json({ version: BUILD_VERSION, buildDate: BUILD_DATE, status: 'running' });
});

app.listen(PORT, () => {
    console.log(`🚀 KAIROS Commercial Bots running on port ${PORT}`);
});
