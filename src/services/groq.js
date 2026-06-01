const Groq = require('groq-sdk');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// In-memory conversation history
// Schema: { [clientId]: { [remoteJid]: [ {role, content} ] } }
const memory = {};

async function generateResponse(clientId, config, remoteJid, userMessage) {
    if (!memory[clientId]) memory[clientId] = {};
    if (!memory[clientId][remoteJid]) {
        // Initialize memory with system prompt based on config
        const systemPrompt = `Você é o assistente virtual do negócio: ${config.name}.
Tom de voz: ${config.tone}.
Serviços: ${JSON.stringify(config.services || {})}.
Público Alvo: ${config.targetAudience || ''}.
Abaixo estão exemplos de como você deve responder:
${JSON.stringify(config.attendant?.examples || [])}

Seja conciso, prestativo e persuasivo. Apenas responda ao usuário como o assistente do negócio.`;

        memory[clientId][remoteJid] = [
            { role: 'system', content: systemPrompt }
        ];
    }

    const chatHistory = memory[clientId][remoteJid];
    chatHistory.push({ role: 'user', content: userMessage });

    // Keep history bounded to avoid token limit
    if (chatHistory.length > 20) {
        // Keep system prompt (index 0) and remove oldest messages
        chatHistory.splice(1, 2);
    }

    try {
        const completion = await groq.chat.completions.create({
            messages: chatHistory,
            model: "llama-3.3-70b-versatile",
            temperature: 0.5,
            max_tokens: 300
        });

        const reply = completion.choices[0].message.content;
        chatHistory.push({ role: 'assistant', content: reply });

        return reply;
    } catch (error) {
        console.error(`[Groq Error - ${clientId}]`, error.message);
        return "Desculpe, estou com uma instabilidade no momento. Posso ajudar em breve.";
    }
}

module.exports = { generateResponse };
