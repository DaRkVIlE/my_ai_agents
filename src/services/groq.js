const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chat } = require('./llm');
const { getSession, setSession } = require('./redis');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
4. Se o usuário mandar um áudio (aparecerá como [ÁUDIO TRANSCRITO]), responda ao conteúdo da transcrição naturalmente.
5. Quando pedir para o cliente enviar uma foto/imagem para avaliação ou orçamento, instrua-o sempre a enviar a foto JUNTO com uma legenda ou áudio explicando os detalhes do que ele deseja.`;
}

async function generateResponse(clientId, config, remoteJid, userMessage, isAdmin = false, imageBase64 = null) {
    const lowerMsg = userMessage.toLowerCase();

    // Command interception for persona switching (only for admins)
    if (isAdmin) {
        if (/(modo atendente|modo cliente)/.test(lowerMsg)) {
            const systemPrompt = getAttendantPrompt(config);
            const msgs = [{ role: 'system', content: systemPrompt }];

            if (config.attendant?.greeting) {
                const greeting = applyTimeGreeting(config.attendant.greeting);
                msgs.push({ role: 'assistant', content: greeting });
            }

            await setSession(clientId, remoteJid, msgs);
            return { text: '🔄 Modo alterado para: *ATENDENTE (Cliente)*. Como posso ajudá-lo hoje?', greeting: null };
        }

        if (/(modo funcion[áa]rio|modo assistente|modo admin)/.test(lowerMsg)) {
            const prompt = config.adminPrompt || 'Você é o assistente interno do negócio. Responda de forma direta e prestativa.';
            await setSession(clientId, remoteJid, [{ role: 'system', content: prompt }]);
            return { text: '🔄 Modo alterado para: *FUNCIONÁRIO (Admin)*. O que manda, chefe?', greeting: null };
        }
    }

    // Load or initialize session from Redis
    let chatHistory = await getSession(clientId, remoteJid);
    let greetingToSend = null;

    if (!chatHistory) {
        // Nova sessão
        const systemPrompt = (isAdmin && config.adminPrompt) ? config.adminPrompt : getAttendantPrompt(config);
        chatHistory = [{ role: 'system', content: systemPrompt }];

        // Pre-inject greeting as already-sent message so LLM doesn't repeat it
        if (!isAdmin && config.attendant?.greeting) {
            const greeting = applyTimeGreeting(config.attendant.greeting);
            chatHistory.push({ role: 'assistant', content: greeting });
            greetingToSend = greeting;
        }
    }

    // Preparar conteúdo do usuário (suporte a Visão)
    let content;
    if (imageBase64) {
        const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
        content = [
            { type: 'text', text: userMessage && userMessage !== '[MÍDIA IGNORADA]' ? userMessage : 'O cliente enviou esta imagem. Analise-a e responda de acordo com seu papel.' },
            { type: 'image_url', image_url: { url: dataUrl } }
        ];
    } else {
        content = userMessage;
    }

    chatHistory.push({ role: 'user', content });

    // Keep history bounded (max 20 messages + system prompt)
    if (chatHistory.length > 22) {
        chatHistory.splice(1, 2);
    }

    try {
        // Envia para o LLM
        const reply = await chat(chatHistory);
        chatHistory.push({ role: 'assistant', content: reply });

        // Sanitização de Memória: Remover o base64 gigante do histórico antes de salvar no Redis
        const historyToSave = chatHistory.map(msg => {
            if (Array.isArray(msg.content)) {
                return {
                    role: msg.role,
                    content: msg.content.map(c => c.type === 'image_url' ? { type: 'text', text: '[IMAGEM PROCESSADA NESTE TURNO]' } : c)
                };
            }
            return msg;
        });

        // Persist updated session (sem as imagens pesadas)
        await setSession(clientId, remoteJid, historyToSave);

        return { text: reply, greeting: greetingToSend };
    } catch (error) {
        console.error(`[generateResponse - ${clientId}]`, error.message);
        return { text: 'Desculpe, estou com uma instabilidade no momento. Pode tentar em breve?', greeting: null };
    }
}

function applyTimeGreeting(greeting) {
    const hour = new Date().getHours();
    let period = 'Bom dia';
    if (hour >= 12 && hour < 18) period = 'Boa tarde';
    else if (hour >= 18) period = 'Boa noite';
    return greeting.replace(/bom dia|boa tarde|boa noite/gi, period);
}

async function transcribeAudio(base64Audio) {
    if (!base64Audio) {
        console.warn('[Whisper] base64Audio é null/undefined — abortando transcrição');
        return null;
    }

    // DEBUG: log do prefixo para diagnóstico
    const preview = base64Audio.substring(0, 120);
    console.log(`[Whisper] base64 preview: ${preview}`);
    console.log(`[Whisper] Tamanho do base64: ${base64Audio.length} chars`);

    try {
        // Split seguro — cobre qualquer variante do prefixo (ogg, ogg;codecs=opus, mp4, etc)
        const base64Data = base64Audio.includes('base64,')
            ? base64Audio.split('base64,')[1]
            : base64Audio;

        const buffer = Buffer.from(base64Data, 'base64');
        console.log(`[Whisper] Buffer gerado: ${buffer.length} bytes`);

        if (buffer.length < 1000) {
            console.warn('[Whisper] Buffer muito pequeno — possível base64 corrompido');
            return null;
        }

        // Detecta extensão pelo prefixo MIME
        let ext = 'ogg';
        if (base64Audio.includes('audio/mp4')) ext = 'mp4';
        else if (base64Audio.includes('audio/mpeg')) ext = 'mp3';
        else if (base64Audio.includes('audio/wav')) ext = 'wav';

        const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.${ext}`);
        fs.writeFileSync(tempFilePath, buffer);

        console.log(`[Whisper] Enviando para transcrição: ${tempFilePath} (${ext})`);

        const transcription = await groq.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: 'whisper-large-v3',
            language: 'pt',
        });

        fs.unlinkSync(tempFilePath);

        console.log(`[Whisper] Transcrição concluída: "${transcription.text}"`);
        return transcription.text;
    } catch (error) {
        console.error('[Whisper] Erro na transcrição:', error.message);
        if (error.response) {
            console.error('[Whisper] Response status:', error.response.status);
            console.error('[Whisper] Response data:', JSON.stringify(error.response.data));
        }
        return null;
    }
}

module.exports = { generateResponse, transcribeAudio };
