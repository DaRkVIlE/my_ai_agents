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
        // Tenta primeiro com Llama 3.2 11B Vision (estável no Groq — o 90B está em preview instável)
        console.log('[LLM] Imagem detectada. Tentando Groq Llama 3.2 11B Vision (estável)...');
        const visionOptions11b = { ...options, model: 'llama-3.2-11b-vision-preview' };
        const result11b = await tryProvider('groq', messages, visionOptions11b, chatWithGroq);
        if (result11b) return result11b;

        // Fallback: Llama 3.2 90B Vision (mais poderoso mas menos estável)
        console.log('[LLM] 11B falhou. Tentando Groq Llama 3.2 90B Vision...');
        const visionOptions90b = { ...options, model: 'llama-3.2-90b-vision-preview' };
        const result90b = await tryProvider('groq', messages, visionOptions90b, chatWithGroq);
        if (result90b) return result90b;

        // Fallback final: Gemini 2.0 Flash (multimodal robusto)
        console.log('[LLM] Groq Vision esgotado. Acionando fallback Gemini 2.0 Flash...');
        const geminiResult = await tryProvider('gemini', messages, options, chatWithGeminiREST);
        if (geminiResult) return geminiResult;

        throw new Error('Todos os providers de Visão falharam (Groq 11B + 90B + Gemini 2.0 Flash).');
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
