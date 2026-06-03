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

function getAttendantPrompt(config) {
    return `Você é o assistente virtual do negócio: ${config.name}.
Tom de voz: ${config.tone}.
Serviços: ${JSON.stringify(config.services || {})}.
Público Alvo: ${config.targetAudience || ''}.
Abaixo estão exemplos de como você deve responder:
${JSON.stringify(config.attendant?.examples || [])}

DIRETRIZES IMPORTANTES:
1. Seja conciso, prestativo e persuasivo.
2. A saudação inicial JÁ FOI ENVIADA para o cliente. Portanto, NUNCA inicie suas respostas com saudações (ex: "Olá", "Boa tarde", "Seja bem vindo").
3. Vá direto ao ponto e responda DIRETAMENTE à pergunta ou comentário do usuário.
4. Se o usuário mandar um áudio (aparecerá como [ÁUDIO TRANSCRITO]), responda ao conteúdo da transcrição naturalmente.`;
}

async function generateResponse(clientId, config, remoteJid, userMessage, isAdmin = false) {
    const lowerMsg = userMessage.toLowerCase();
    
    // Command interception for persona switching (only for admins/demos)
    if (isAdmin) {
        if (/(modo atendente|modo cliente)/.test(lowerMsg)) {
            if (!memory[clientId]) memory[clientId] = {};
            memory[clientId][remoteJid] = [{ role: 'system', content: getAttendantPrompt(config) }];
            
            // Pre-inject the greeting to simulate that it was already sent, so the LLM has context
            if (config.attendant?.greeting) {
                const now = new Date();
                const hour = now.getHours();
                let period = 'Bom dia';
                if (hour >= 12 && hour < 18) period = 'Boa tarde';
                else if (hour >= 18) period = 'Boa noite';
                const greeting = config.attendant.greeting.replace(/bom dia|boa tarde|boa noite/i, period);
                memory[clientId][remoteJid].push({ role: 'assistant', content: greeting });
            }
            
            return { text: "🔄 Modo alterado para: *ATENDENTE (Cliente)*. Como posso ajudá-lo hoje?", greeting: null };
        }

        if (/(modo funcion[áa]rio|modo assistente|modo admin)/.test(lowerMsg)) {
            if (!memory[clientId]) memory[clientId] = {};
            const prompt = config.adminPrompt || "Você é o assistente interno do negócio. Responda de forma direta e prestativa.";
            memory[clientId][remoteJid] = [{ role: 'system', content: prompt }];
            return { text: "🔄 Modo alterado para: *FUNCIONÁRIO (Admin)*. O que manda, chefe?", greeting: null };
        }
    }

    if (!memory[clientId]) memory[clientId] = {};
    
    let greetingToSend = null;
    if (!memory[clientId][remoteJid]) {
        // Initialize memory with system prompt based on config
        const systemPrompt = (isAdmin && config.adminPrompt) ? config.adminPrompt : getAttendantPrompt(config);
        memory[clientId][remoteJid] = [{ role: 'system', content: systemPrompt }];

        // Pre-inject the greeting as an already-sent assistant message.
        // This prevents the LLM from being instructed to "always greet first",
        // which causes it to ignore the actual content (e.g. a transcribed audio).
        if (!isAdmin && config.attendant?.greeting) {
            const now = new Date();
            const hour = now.getHours();
            let period = 'Bom dia';
            if (hour >= 12 && hour < 18) period = 'Boa tarde';
            else if (hour >= 18) period = 'Boa noite';
            const greeting = config.attendant.greeting.replace(/bom dia|boa tarde|boa noite/i, period);
            memory[clientId][remoteJid].push({ role: 'assistant', content: greeting });
            greetingToSend = greeting; // will be sent before processing user message
        }
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

        return { text: reply, greeting: greetingToSend };
    } catch (error) {
        console.error(`[Groq Error - ${clientId}]`, error.message);
        return { text: "Desculpe, estou com uma instabilidade no momento. Posso ajudar em breve.", greeting: null };
    }
}


async function transcribeAudio(base64Audio) {
    if (!base64Audio) return null;
    try {
        // Garante a extração limpa do base64 independente do prefixo (ex: data:audio/ogg; codecs=opus;base64,)
        const base64Data = base64Audio.includes('base64,') ? base64Audio.split('base64,')[1] : base64Audio;
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
