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

async function chatWithOpenRouter(messages, options, key) {
    const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
            model: options.model || 'meta-llama/llama-4-scout-17b-16e-instruct',
            messages,
            temperature: options.temperature ?? 0.5,
            max_tokens: options.max_tokens || 300,
        },
        {
            headers: { 
                Authorization: `Bearer ${key}`, 
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://kairos-os.com',
                'X-Title': 'KAIROS Bots'
            },
            timeout: 45000,
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
                    // Usa flag 's' (dotAll) para capturar base64 com quebras de linha
                    const match = c.image_url.url.match(/^data:(image\/[\w.+-]+)(?:;[^,]+)*;base64,([\s\S]+)$/);
                    if (match) {
                        // Remove whitespace/newlines do base64 antes de enviar
                        parts.push({ inlineData: { mimeType: match[1], data: match[2].replace(/\s/g, '') } });
                    } else {
                        console.warn('[GeminiREST] Formato de data URL inválido ou não reconhecido:', c.image_url.url.substring(0, 80));
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const response = await axios.post(url, payload, { timeout: 45000 });
    
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini retornou resposta vazia ou sem candidatos');
    return text;
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
        console.log('[LLM] Imagem detectada. Tentando OpenRouter (Llama 4 Scout 17B)...');
        const resultScout = await tryProvider('openrouter', messages, { ...options, model: 'meta-llama/llama-4-scout-17b-16e-instruct' }, chatWithOpenRouter);
        if (resultScout) return resultScout;

        console.log('[LLM] Scout falhou. Tentando OpenRouter (Llama 4 Maverick 17B)...');
        const resultMaverick = await tryProvider('openrouter', messages, { ...options, model: 'meta-llama/llama-4-maverick-17b-128e-instruct' }, chatWithOpenRouter);
        if (resultMaverick) return resultMaverick;

        console.log('[LLM] Maverick falhou. Tentando OpenRouter (Qwen 2.5 VL 72B)...');
        const resultQwen = await tryProvider('openrouter', messages, { ...options, model: 'qwen/qwen2.5-vl-72b-instruct' }, chatWithOpenRouter);
        if (resultQwen) return resultQwen;

        console.log('[LLM] OpenRouter esgotado. Acionando fallback final Gemini 2.0 Flash...');
        const geminiResult = await tryProvider('gemini', messages, options, chatWithGeminiREST);
        if (geminiResult) return geminiResult;

        throw new Error('Todos os providers de Visão falharam (OpenRouter Scout/Maverick/Qwen + Gemini 2.0 Flash).');
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
