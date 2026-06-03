const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const os = require('os');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// In-memory conversation history
// Schema: { [clientId]: { [remoteJid]: [ {role, content} ] } }
const memory = {};

async function generateResponse(clientId, config, remoteJid, userMessage, isAdmin = false) {
    if (!memory[clientId]) memory[clientId] = {};
    if (!memory[clientId][remoteJid]) {
        // Initialize memory with system prompt based on config
        let systemPrompt = '';
        if (isAdmin && config.adminPrompt) {
            systemPrompt = config.adminPrompt;
        } else {
            systemPrompt = `Você é o assistente virtual do negócio: ${config.name}.
Tom de voz: ${config.tone}.
Serviços: ${JSON.stringify(config.services || {})}.
Público Alvo: ${config.targetAudience || ''}.
Abaixo estão exemplos de como você deve responder:
${JSON.stringify(config.attendant?.examples || [])}

Seja conciso, prestativo e persuasivo. Apenas responda ao usuário como o assistente do negócio.
${config.attendant?.greeting ? `\nIMPORTANTE: A sua PRIMEIRA MENSAGEM ao cliente deve ser EXATAMENTE esta saudação: "${config.attendant.greeting}". Adapte apenas o "Boa tarde" para o horário atual se necessário, mas mantenha o restante do texto idêntico.` : ''}`;
        }

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

async function transcribeAudio(base64Audio) {
    if (!base64Audio) return null;
    try {
        // Strip out metadata if present e.g., "data:audio/ogg;base64,"
        const base64Data = base64Audio.replace(/^data:audio\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Save to temporary file
        const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.ogg`);
        fs.writeFileSync(tempFilePath, buffer);
        
        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-large-v3",
            language: "pt"
        });
        
        // Cleanup temp file
        fs.unlinkSync(tempFilePath);
        
        return transcription.text;
    } catch (error) {
        console.error("[Groq Audio Error]", error.message);
        return null;
    }
}

module.exports = { generateResponse, transcribeAudio };
