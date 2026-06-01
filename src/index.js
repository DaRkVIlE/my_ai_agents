require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { generateResponse } = require('./services/groq');
const { sendMessage } = require('./services/evolution');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

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
    console.log(`[Webhook Hit] clientId: ${req.params.clientId}, event: ${req.params.event || 'none'}`);
    console.log(`[Payload]:`, JSON.stringify(req.body, null, 2));

    try {
        const { clientId } = req.params;
        const config = loadClientConfig(clientId);

        if (!config) {
            console.error(`[Webhook] Config not found for client: ${clientId}`);
            return res.status(404).send('Client config not found');
        }

        const body = req.body;
        
        // Evolution API validation
        if (!body || !body.data || !body.data.message) {
            return res.status(200).send('Event ignored');
        }

        const msgData = body.data;
        const remoteJid = msgData.key.remoteJid;
        const fromMe = msgData.key.fromMe;
        
        // Ignore status broadcasts and own messages
        if (remoteJid === 'status@broadcast' || fromMe) {
            return res.status(200).send('Ignored');
        }

        // Get message text
        const message = msgData.message;
        let text = "";
        if (message.conversation) {
            text = message.conversation;
        } else if (message.extendedTextMessage?.text) {
            text = message.extendedTextMessage.text;
        } else if (message.audioMessage || message.imageMessage || message.videoMessage || message.documentMessage) {
            text = "[ÁUDIO/MÍDIA]";
        }

        if (!text) {
            return res.status(200).send('No text');
        }

        console.log(`[${clientId.toUpperCase()}] Mensagem recebida de ${remoteJid}: ${text}`);

        // Generate response via Groq
        const replyText = await generateResponse(clientId, config, remoteJid, text);

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

app.listen(PORT, () => {
    console.log(`🚀 KAIROS Commercial Bots running on port ${PORT}`);
});
