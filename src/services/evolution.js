const axios = require('axios');

async function sendMessage(clientId, remoteJid, text) {
    const apiUrl = process.env.EVOLUTION_API_URL || 'https://evolution.kairos-os.com';
    const globalApiKey = process.env.EVOLUTION_GLOBAL_APIKEY;
    
    // Default to a generic instance name based on client, or override with env var
    // Actually, Evolution instance is global in Railway right now, let's use the env var or fallback
    // Since it's multi-tenant but maybe using a single WhatsApp number, we use INSTANCE_NAME or fallback to clientId
    const instanceName = process.env.INSTANCE_NAME || `${clientId}`;

    try {
        await axios.post(
            `${apiUrl}/message/sendText/${instanceName}`,
            {
                number: remoteJid,
                text: text
            },
            {
                headers: {
                    'apikey': globalApiKey,
                    'Content-Type': 'application/json'
                }
            }
        );
    } catch (error) {
        console.error(`[Evolution Error - ${clientId}]`, error.message);
        throw error;
    }
}

module.exports = { sendMessage };
