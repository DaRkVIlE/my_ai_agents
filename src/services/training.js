/**
 * training.js — Módulo Admin de Treinamento da Felícia
 * Permite que o dono do bot treine a IA diretamente pelo WhatsApp.
 *
 * Comandos disponíveis (admin only):
 *   /treinar        → Inicia o modo de treinamento guiado
 *   /regras         → Lista todas as regras permanentes salvas
 *   /apagar N       → Remove regra permanente pelo número
 *   /ajuda          → Exibe menu de comandos admin
 *   !regra <texto>  → Atalho rápido para adicionar regra (sem modo guiado)
 *
 * Regras são persistidas em dois lugares:
 *   1. felix.json (campo "permanentRules") — sobrevive a restarts
 *   2. Redis (campo dinâmico) — injetado no contexto do LLM em tempo real
 */

const fs = require('fs');
const path = require('path');

const TRAINING_STATE = new Map(); // jid → { step, pergunta }
const TRAINING_TTL_MS = 5 * 60 * 1000; // 5 min de inatividade encerra o treino

// ── Persistência em arquivo JSON ─────────────────────────────────────────────

function getConfigPath(clientId) {
    return path.join(__dirname, '..', 'config', 'clients', `${clientId}.json`);
}

function loadConfig(clientId) {
    const configPath = getConfigPath(clientId);
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function saveConfig(clientId, config) {
    const configPath = getConfigPath(clientId);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

function getPermanentRules(clientId) {
    const config = loadConfig(clientId);
    return config.permanentRules || [];
}

function addPermanentRule(clientId, rule) {
    const config = loadConfig(clientId);
    if (!config.permanentRules) config.permanentRules = [];
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    config.permanentRules.push({ rule, addedAt: timestamp });
    saveConfig(clientId, config);
    return config.permanentRules;
}

function removePermanentRule(clientId, idx) {
    const config = loadConfig(clientId);
    if (!config.permanentRules || idx < 0 || idx >= config.permanentRules.length) {
        return null;
    }
    const removed = config.permanentRules.splice(idx, 1)[0];
    saveConfig(clientId, config);
    return { removed, remaining: config.permanentRules };
}

// ── Estado do modo treinamento (por sessão) ───────────────────────────────────

function getTrainingState(jid) {
    const state = TRAINING_STATE.get(jid);
    if (!state) return null;
    // TTL: encerra se ficou mais de 5 min sem atividade
    if (Date.now() - state.lastActivity > TRAINING_TTL_MS) {
        TRAINING_STATE.delete(jid);
        return null;
    }
    return state;
}

function setTrainingState(jid, data) {
    TRAINING_STATE.set(jid, { ...data, lastActivity: Date.now() });
}

function clearTrainingState(jid) {
    TRAINING_STATE.delete(jid);
}

// ── Handler principal ────────────────────────────────────────────────────────

/**
 * handleTrainingCommand(clientId, jid, text)
 * Retorna uma string de resposta se o comando foi tratado, ou null se não é um comando de treino.
 */
async function handleTrainingCommand(clientId, jid, text) {
    const msg = text.trim();
    const lower = msg.toLowerCase();

    // ── /ajuda ─────────────────────────────────────────────────────────────
    if (lower === '/ajuda' || lower === '/help') {
        clearTrainingState(jid);
        return (
            `🛠️ *Menu Admin — Felícia*\n\n` +
            `*/treinar* — Iniciar modo de treinamento guiado\n` +
            `*/regras* — Ver todas as regras salvas\n` +
            `*/apagar N* — Remover a regra de número N\n` +
            `*!regra <texto>* — Adicionar regra rápida sem modo guiado\n\n` +
            `*desligar bot* — Colocar bot em standby\n` +
            `*ligar bot* — Reativar o bot\n` +
            `*retomar <número>* — Reativar bot para um cliente específico\n\n` +
            `— Felícia Admin Mode 🤖`
        );
    }

    // ── /regras ────────────────────────────────────────────────────────────
    if (lower === '/regras' || lower === '!regras' || lower === '!listar') {
        clearTrainingState(jid);
        const rules = getPermanentRules(clientId);
        if (rules.length === 0) {
            return '📋 Nenhuma regra permanente salva ainda.\n\nUse */treinar* ou *!regra <texto>* para adicionar.';
        }
        const lista = rules.map((r, i) => `${i + 1}. ${r.rule}\n   _Adicionada em: ${r.addedAt}_`).join('\n\n');
        return `📋 *Regras permanentes (${rules.length}):*\n\n${lista}\n\nUse */apagar N* para remover uma regra.`;
    }

    // ── /apagar N ──────────────────────────────────────────────────────────
    const apagarMatch = msg.match(/^\/apagar\s+(\d+)$/i);
    if (apagarMatch) {
        clearTrainingState(jid);
        const idx = parseInt(apagarMatch[1], 10) - 1;
        const result = removePermanentRule(clientId, idx);
        if (!result) {
            const rules = getPermanentRules(clientId);
            return `⚠️ Número inválido. Use */regras* para ver a lista (1 a ${rules.length}).`;
        }
        const lista = result.remaining.length > 0
            ? result.remaining.map((r, i) => `${i + 1}. ${r.rule}`).join('\n')
            : 'Nenhuma regra ativa.';
        return `✅ Regra removida: _"${result.removed.rule}"_\n\n📋 *Regras restantes:*\n${lista}`;
    }

    // ── !regra <texto> (atalho rápido sem modo guiado) ────────────────────
    const quickRuleMatch = msg.match(/^!regra\s+(.+)/is);
    if (quickRuleMatch) {
        clearTrainingState(jid);
        const novaRegra = quickRuleMatch[1].trim();
        const rules = addPermanentRule(clientId, novaRegra);
        return (
            `✅ *Regra adicionada e salva permanentemente!*\n\n` +
            `📌 "${novaRegra}"\n\n` +
            `📋 Total de regras: ${rules.length}\n` +
            `Use */regras* para ver todas.`
        );
    }

    // ── /treinar — MODO GUIADO ─────────────────────────────────────────────
    if (lower === '/treinar') {
        setTrainingState(jid, { step: 'aguardando_situacao' });
        return (
            `🎓 *Modo Treinamento Ativado*\n\n` +
            `Vamos ensinar algo novo à Felícia.\n\n` +
            `📝 *Passo 1 de 2:*\nQual foi a pergunta ou situação que o cliente teve? ` +
            `(Pode ser um exemplo real ou algo que você espera que aconteça)\n\n` +
            `_Ou envie /cancelar para sair do modo treinamento._`
        );
    }

    // ── MODO GUIADO: fluxo de 2 passos ────────────────────────────────────
    const state = getTrainingState(jid);
    if (state) {
        if (lower === '/cancelar') {
            clearTrainingState(jid);
            return '❌ Treinamento cancelado. A Felícia continua com as regras anteriores.';
        }

        if (state.step === 'aguardando_situacao') {
            setTrainingState(jid, { step: 'aguardando_resposta_ideal', pergunta: msg });
            return (
                `📝 *Passo 2 de 2:*\n` +
                `Situação registrada: _"${msg}"_\n\n` +
                `Agora me diga: qual seria a *resposta ideal* que a Felícia deveria dar nessa situação?\n\n` +
                `_Envie /cancelar para sair._`
            );
        }

        if (state.step === 'aguardando_resposta_ideal') {
            const situacao = state.pergunta;
            const respostaIdeal = msg;

            // Monta a regra estruturada
            const novaRegra = `Quando o cliente disser algo como "${situacao}", responda: "${respostaIdeal}"`;
            const rules = addPermanentRule(clientId, novaRegra);

            clearTrainingState(jid);

            return (
                `✅ *Felícia treinada com sucesso!*\n\n` +
                `📌 *Situação:* ${situacao}\n` +
                `💬 *Resposta aprendida:* ${respostaIdeal}\n\n` +
                `Essa regra foi salva permanentemente e já está ativa (${rules.length} regra${rules.length > 1 ? 's' : ''} no total).\n\n` +
                `Use */treinar* para ensinar mais ou */regras* para ver tudo.`
            );
        }
    }

    // Não é um comando de treinamento
    return null;
}

/**
 * buildPermanentRulesBlock(clientId)
 * Retorna um bloco de texto formatado para injetar no System Prompt do LLM.
 * Retorna string vazia se não houver regras permanentes.
 */
function buildPermanentRulesBlock(clientId) {
    try {
        const rules = getPermanentRules(clientId);
        if (rules.length === 0) return '';
        const lista = rules.map((r, i) => `${i + 1}. ${r.rule}`).join('\n');
        return `\n\n🔒 REGRAS PERMANENTES TREINADAS PELO GESTOR (prioridade máxima — nunca ignore):\n${lista}`;
    } catch (e) {
        console.error('[Training] Erro ao ler regras permanentes:', e.message);
        return '';
    }
}

module.exports = {
    handleTrainingCommand,
    buildPermanentRulesBlock,
    getPermanentRules,
    addPermanentRule,
    removePermanentRule,
};
