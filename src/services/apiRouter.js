const keys = require('../config/keys.json');

class ApiRouter {
    constructor() {
        this.pointers = {
            groq: 0,
            gemini: 0,
            together: 0,
            sambanova: 0,
            openrouter: 0,
            cerebras: 0
        };
    }

    /**
     * Retorna a chave atual para o provedor
     */
    getKey(provider) {
        if (!keys[provider] || keys[provider].length === 0) return null;
        return keys[provider][this.pointers[provider] % keys[provider].length];
    }

    /**
     * Avança para a próxima chave (rotação) do provedor
     */
    rotateKey(provider) {
        if (!keys[provider] || keys[provider].length === 0) return null;
        this.pointers[provider]++;
        console.log(`[Router] Rotacionando chave do ${provider} para índice ${this.pointers[provider] % keys[provider].length}`);
        return this.getKey(provider);
    }
}

module.exports = new ApiRouter();
