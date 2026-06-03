const axios = require('axios');

/**
 * Envia mensagem de texto via Evolution API.
 * instanceName e apiKey são lidos da config do cliente (multitenant).
 * Fallback para variáveis de ambiente globais.
 */
async function sendMessage(clientId, remoteJid, text, config = {}) {
    const apiUrl = process.env.EVOLUTION_API_URL || 'https://evolution.kairos-os.com';
    const instanceName = config.instanceName || process.env.INSTANCE_NAME || clientId;
    const apiKey = config.instanceApiKey || process.env.EVOLUTION_GLOBAL_APIKEY;

    try {
        await axios.post(
            `${apiUrl}/message/sendText/${instanceName}`,
            { number: remoteJid, text },
            {
                headers: {
                    'apikey': apiKey,
                    'Content-Type': 'application/json',
                },
                timeout: 15000,
            }
        );
    } catch (error) {
        console.error(`[Evolution sendMessage - ${clientId}] ${error.message}`);
        throw error;
    }
}

/**
 * Obtém o base64 de uma mensagem de mídia via Evolution API.
 * Usado quando o webhook não traz o base64 inline.
 */
async function getMediaBase64(clientId, messageObj, config = {}) {
    const apiUrl = process.env.EVOLUTION_API_URL || 'https://evolution.kairos-os.com';
    const instanceName = config.instanceName || process.env.INSTANCE_NAME || clientId;
    const apiKey = config.instanceApiKey || process.env.EVOLUTION_GLOBAL_APIKEY;

    try {
        const response = await axios.post(
            `${apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
            { message: messageObj },
            {
                headers: {
                    'apikey': apiKey,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            }
        );

        const base64 = response.data?.base64 || response.data?.data?.base64;
        if (!base64) {
            console.warn(`[Evolution getMediaBase64 - ${clientId}] Resposta sem base64:`, JSON.stringify(response.data).substring(0, 200));
        }
        return base64 || null;
    } catch (error) {
        console.error(`[Evolution getMediaBase64 - ${clientId}] ${error.message}`);
        if (error.response) {
            console.error(`[Evolution] Status: ${error.response.status}`, JSON.stringify(error.response.data).substring(0, 300));
        }
        return null;
    }
}

module.exports = { sendMessage, getMediaBase64 };
