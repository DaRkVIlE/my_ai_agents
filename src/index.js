require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { generateResponse, transcribeAudio } = require('./services/groq');
const { sendMessage, getMediaBase64 } = require('./services/evolution');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const BUILD_VERSION = '2.1.0';
const BUILD_DATE = '2026-06-02T14:53:00Z';

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
        const isAdmin = config.adminNumbers && config.adminNumbers.includes(remoteJid);

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
            
            if (base64) {
                const transcript = await transcribeAudio(base64);
                if (transcript) {
                    text = `[ÁUDIO TRANSCRITO]: ${transcript}`;
                    console.log(`[${clientId.toUpperCase()}] Transcrição: ${transcript}`);
                } else {
                    text = "[ERRO NA TRANSCRIÇÃO DE ÁUDIO]";
                }
            } else {
                text = "[FALHA AO BAIXAR ÁUDIO]";
            }
        } else if (message.imageMessage || message.videoMessage || message.documentMessage) {
            text = "[MÍDIA IGNORADA]";
        }

        if (!text) {
            return res.status(200).send('No text');
        }

        console.log(`[${clientId.toUpperCase()}] Mensagem recebida de ${remoteJid} (Admin: ${isAdmin}): ${text}`);

        // Generate response via Groq
        const replyText = await generateResponse(clientId, config, remoteJid, text, isAdmin);

        // Send response via Evolution
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
