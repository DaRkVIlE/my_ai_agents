/**
 * AIDA TTS — Text-to-Speech via Groq
 * Gera mensagens de voz para o aluno treinar listening
 * 
 * Formato de saída: .ogg (Opus) — nativo do Telegram Voice Message
 * Dex (Dev) — Experia Solutions
 */

const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Vozes disponíveis no Groq TTS (PlayAI)
// Usamos vozes em inglês para o aluno treinar listening
const PERSONA_VOICES = {
    tech:     'Fritz-PlayAI',      // Alex — voz masculina neutra, americana
    sports:   'Mason-PlayAI',      // Jordan — voz masculina energética
    travel:   'Aaliyah-PlayAI',    // Mia — voz feminina britânica
    business: 'Fritz-PlayAI',      // Chris — voz profissional
    culture:  'Atlas-PlayAI',      // Sam — voz masculina laid-back
    general:  'Celeste-PlayAI',    // Jamie — voz feminina calorosa, padrão
};

const DEFAULT_VOICE = 'Celeste-PlayAI';
const TTS_MODEL = 'playai-tts';

/**
 * Gera áudio a partir de texto usando Groq TTS
 * @param {string} text - Texto a ser convertido em áudio
 * @param {string} interesse - Interesse do aluno (tech/sports/travel/etc) para selecionar voz
 * @returns {Buffer|null} - Buffer .ogg pronto para enviar ao Telegram, ou null se falhar
 */
async function generateVoiceMessage(text, interesse = 'general') {
    if (!process.env.GROQ_API_KEY) {
        console.warn('[TTS] GROQ_API_KEY não definida — TTS desabilitado');
        return null;
    }

    // Limitar texto (TTS tem limite de ~4000 chars, mas shortcircuit para mensagens longas)
    const truncated = text.length > 500 ? text.substring(0, 500) + '...' : text;

    // Selecionar voz baseado na persona do tutor
    const voice = PERSONA_VOICES[interesse] || DEFAULT_VOICE;

    let tempFilePath = null;

    try {
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

        console.log(`[TTS] Gerando voz: ${voice} | ${truncated.length} chars`);

        const response = await groq.audio.speech.create({
            model: TTS_MODEL,
            voice: voice,
            input: truncated,
            response_format: 'opus', // Opus = .ogg, nativo do Telegram
        });

        // Converter resposta para Buffer
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log(`[TTS] Áudio gerado: ${buffer.length} bytes`);

        // Salvar temporariamente (o Telegraf precisa de stream ou path para sendVoice)
        tempFilePath = path.join(os.tmpdir(), `aida_tts_${Date.now()}.ogg`);
        fs.writeFileSync(tempFilePath, buffer);

        return tempFilePath;

    } catch (err) {
        console.error('[TTS] Erro ao gerar voz:', err.message);
        // Limpar arquivo temporário se criado
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
        return null;
    }
}

/**
 * Limpar arquivo temporário após envio
 * @param {string} filePath 
 */
function cleanupTempFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (e) {
            // Silencioso — não crítico
        }
    }
}

module.exports = { generateVoiceMessage, cleanupTempFile };
