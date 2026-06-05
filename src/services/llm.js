const Groq = require('groq-sdk');
const axios = require('axios');
const apiRouter = require('./apiRouter');

/**
 * Abstração de providers de LLM com cascata de fallback massivo.
 * Providers: Groq → Cerebras → SambaNova → OpenRouter → Gemini
 */

async function chatWithGroq(messages, options, key) {
    const client = new Groq({ apiKey: key });
    const completion = await client.chat.completions.create({
        messages,
        model: options.model || 'llama-3.3-70b-versatile',
        temperature: options.temperature ?? 0.5,
        max_tokens: options.max_tokens || 300,
    });
    return completion.choices[0].message.content;
}

async function chatWithSambanova(messages, options, key) {
    const response = await axios.post(
        'https://api.sambanova.ai/v1/chat/completions',
        {
            model: options.model || 'Meta-Llama-3.3-70B-Instruct',
            messages,
            temperature: options.temperature ?? 0.5,
            max_tokens: options.max_tokens || 300,
        },
        {
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            timeout: 30000,
        }
    );
    return response.data.choices[0].message.content;
}

async function chatWithCerebras(messages, options, key) {
    const response = await axios.post(
        'https://api.cerebras.ai/v1/chat/completions',
        {
            model: options.model || 'llama3.1-8b',
            messages,
            temperature: options.temperature ?? 0.5,
            max_tokens: options.max_tokens || 300,
        },
        {
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            timeout: 30000,
        }
    );
    return response.data.choices[0].message.content;
}

async function chatWithGeminiREST(messages, options, key) {
    const contents = [];
    let systemInstruction = null;

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemInstruction = { parts: [{ text: msg.content }] };
            continue;
        }
        
        let role = msg.role === 'assistant' ? 'model' : 'user';
        const parts = [];
        
        if (Array.isArray(msg.content)) {
            for (const c of msg.content) {
                if (c.type === 'text') parts.push({ text: c.text });
                if (c.type === 'image_url') {
                    const match = c.image_url.url.match(/^data:(image\/\w+);base64,(.+)$/);
                    if (match) {
                        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                    }
                }
            }
        } else {
            parts.push({ text: msg.content });
        }
        contents.push({ role, parts });
    }

    const payload = { contents };
    if (systemInstruction) payload.systemInstruction = systemInstruction;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
    const response = await axios.post(url, payload, { timeout: 30000 });
    
    return response.data.candidates[0].content.parts[0].text;
}

/**
 * Tenta executar em um provider específico, com rotação se falhar por erro do servidor (ex: 429)
 */
async function tryProvider(providerName, messages, options, chatFunc) {
    const maxAttempts = 3; // Tentar até 3 chaves diferentes do mesmo provider
    let currentKey = apiRouter.getKey(providerName);
    
    if (!currentKey) return null; // Provedor não tem chaves configuradas

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const result = await chatFunc(messages, options, currentKey);
            console.log(`[LLM] Provider: ${providerName} ✓ (Chave ${i+1}/${maxAttempts})`);
            return result;
        } catch (err) {
            const status = err.response?.status || err.status;
            console.warn(`[LLM] ${providerName} falhou: ${err.message} (Status: ${status})`);
            currentKey = apiRouter.rotateKey(providerName);
        }
    }
    return null;
}

/**
 * chat() — fallback massivo em cascata
 */
async function chat(messages, options = {}) {
    const requiresVision = messages.some(msg => 
        Array.isArray(msg.content) && msg.content.some(c => c.type === 'image_url')
    );

    if (requiresVision) {
        console.log('[LLM] Imagem detectada. Tentando visão no Groq (Llama 3.2 Vision)...');
        options.model = 'llama-3.2-11b-vision-preview';
        const result = await tryProvider('groq', messages, options, chatWithGroq);
        if (result) return result;
        
        console.log('[LLM] Groq Vision falhou. Acionando fallback Gemini 1.5 Flash Vision...');
        const geminiResult = await tryProvider('gemini', messages, options, chatWithGeminiREST);
        if (geminiResult) return geminiResult;

        throw new Error('Fallback massivo falhou para Visão Computacional.');
    }

    // Cascata Principal
    const sequence = [
        { name: 'groq', func: chatWithGroq },
        { name: 'cerebras', func: chatWithCerebras },
        { name: 'sambanova', func: chatWithSambanova },
        { name: 'gemini', func: chatWithGeminiREST }
    ];

    for (const provider of sequence) {
        const result = await tryProvider(provider.name, messages, options, provider.func);
        if (result) return result;
    }

    throw new Error('Todos os providers de LLM falharam (Fallback Massivo esgotado)');
}

module.exports = { chat };
