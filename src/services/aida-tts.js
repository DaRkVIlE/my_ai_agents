/**
 * AIDA TTS — Text-to-Speech (Free Tier)
 * Gera mensagens de voz para o aluno treinar listening
 * 
 * Usando google-tts-api (free, sem chave)
 * Dex (Dev) — Experia Solutions
 */

const googleTTS = require('google-tts-api');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

/**
 * Gera áudio a partir de texto usando Google TTS
 * @param {string} text - Texto a ser convertido em áudio
 * @param {string} interesse - Interesse do aluno (ignorado no TTS gratuito)
 * @returns {string|null} - Caminho do arquivo de áudio temporário ou null
 */
async function generateVoiceMessage(text, interesse = 'general') {
    // Limitar texto para o TTS gratuito (limite seguro é ~200 chars por request no google-tts-api, 
    // mas o pacote divide automaticamente se usarmos getAllAudioBase64,
    // para evitar atrasos no bot vamos truncar se for muito longo)
    const truncated = text.length > 500 ? text.substring(0, 500) : text;

    let tempFilePath = null;

    try {
        console.log(`[TTS] Gerando voz via Google TTS (free) | ${truncated.length} chars`);

        // Obter os buffers de áudio em base64 do Google TTS
        // O getAllAudioBase64 contorna o limite de 200 caracteres dividindo o texto internamente
        const audioParts = await googleTTS.getAllAudioBase64(truncated, {
            lang: 'en',
            slow: false,
            host: 'https://translate.google.com',
            splitPunct: ',.?!',
        });

        // Juntar os buffers
        const bufferList = audioParts.map(part => Buffer.from(part.base64, 'base64'));
        const finalBuffer = Buffer.concat(bufferList);

        console.log(`[TTS] Áudio gerado: ${finalBuffer.length} bytes`);

        // Salvar temporariamente como MP3
        tempFilePath = path.join(os.tmpdir(), `aida_tts_${Date.now()}.mp3`);
        fs.writeFileSync(tempFilePath, finalBuffer);

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
