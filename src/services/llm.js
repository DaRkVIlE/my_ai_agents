const Groq = require('groq-sdk');
const axios = require('axios');

/**
 * Abstração de providers de LLM com cascata de fallback.
 * Providers: Groq (primary) → SambaNova (fallback)
 */

const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });

// SambaNova é compatível com OpenAI API format
async function chatWithGroq(messages, options = {}) {
    const completion = await groqClient.chat.completions.create({
        messages,
        model: options.model || 'llama-3.3-70b-versatile',
        temperature: options.temperature ?? 0.5,
        max_tokens: options.max_tokens || 300,
    });
    return completion.choices[0].message.content;
}

async function chatWithSambanova(messages, options = {}) {
    if (!process.env.SAMBANOVA_API_KEY) {
        throw new Error('SAMBANOVA_API_KEY não configurado');
    }

    const response = await axios.post(
        'https://api.sambanova.ai/v1/chat/completions',
        {
            model: 'Meta-Llama-3.3-70B-Instruct',
            messages,
            temperature: options.temperature ?? 0.5,
            max_tokens: options.max_tokens || 300,
        },
        {
            headers: {
                Authorization: `Bearer ${process.env.SAMBANOVA_API_KEY}`,
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        }
    );

    return response.data.choices[0].message.content;
}

/**
 * chat() — tenta Groq, cai para SambaNova se falhar.
 * @param {Array} messages - Array de {role, content}
 * @param {Object} options - model, temperature, max_tokens
 * @returns {string} - Resposta do LLM
 */
async function chat(messages, options = {}) {
    const primaryProvider = process.env.LLM_PRIMARY || 'groq';

    // Tenta provider primário
    try {
        if (primaryProvider === 'groq') {
            const result = await chatWithGroq(messages, options);
            console.log('[LLM] Provider: Groq ✓');
            return result;
        } else if (primaryProvider === 'sambanova') {
            const result = await chatWithSambanova(messages, options);
            console.log('[LLM] Provider: SambaNova ✓');
            return result;
        }
    } catch (primaryErr) {
        console.warn(`[LLM] ${primaryProvider} falhou: ${primaryErr.message} — tentando fallback...`);
    }

    // Fallback
    const fallbackProvider = process.env.LLM_FALLBACK || 'sambanova';
    try {
        if (fallbackProvider === 'sambanova') {
            const result = await chatWithSambanova(messages, options);
            console.log('[LLM] Provider: SambaNova (fallback) ✓');
            return result;
        } else if (fallbackProvider === 'groq') {
            const result = await chatWithGroq(messages, options);
            console.log('[LLM] Provider: Groq (fallback) ✓');
            return result;
        }
    } catch (fallbackErr) {
        console.error(`[LLM] Fallback ${fallbackProvider} também falhou: ${fallbackErr.message}`);
        throw new Error('Todos os providers de LLM falharam');
    }
}

module.exports = { chat };
