const Redis = require('ioredis');

// Graceful fallback: se REDIS_URL não estiver configurado, usa Map em memória
let client = null;
const inMemoryFallback = new Map();
let usingFallback = false;

function getClient() {
    if (client) return client;

    if (!process.env.REDIS_URL && !process.env.REDIS_PRIVATE_URL) {
        if (!usingFallback) {
            console.warn('[Redis] REDIS_URL não configurado — usando fallback em memória (sessões serão perdidas no redeploy)');
            usingFallback = true;
        }
        return null;
    }

    try {
        const url = process.env.REDIS_PRIVATE_URL || process.env.REDIS_URL;
        client = new Redis(url, {
            maxRetriesPerRequest: 2,
            connectTimeout: 5000,
            lazyConnect: false,
        });

        client.on('connect', () => console.log('[Redis] Conectado com sucesso'));
        client.on('error', (err) => console.error('[Redis] Erro de conexão:', err.message));
    } catch (err) {
        console.error('[Redis] Falha ao criar client:', err.message);
        client = null;
    }

    return client;
}

const SESSION_TTL = 60 * 60 * 24; // 24 horas
const RULES_TTL = 60 * 60 * 18;   // 18 horas (expira de madrugada)

function sessionKey(clientId, jid) {
    return `session:${clientId}:${jid}`;
}

function rulesKey(clientId) {
    return `regras:${clientId}`;
}

function pauseKey(clientId, jid) {
    return `paused:${clientId}:${jid}`;
}

function standbyKey(clientId) {
    return `standby:${clientId}`;
}

async function getSession(clientId, jid) {
    const redis = getClient();
    const key = sessionKey(clientId, jid);

    if (!redis) {
        const val = inMemoryFallback.get(key);
        return val ? JSON.parse(val) : null;
    }

    try {
        const val = await redis.get(key);
        return val ? JSON.parse(val) : null;
    } catch (err) {
        console.error('[Redis] getSession error:', err.message);
        return null;
    }
}

async function setSession(clientId, jid, messages) {
    const redis = getClient();
    const key = sessionKey(clientId, jid);
    const serialized = JSON.stringify(messages);

    if (!redis) {
        inMemoryFallback.set(key, serialized);
        return;
    }

    try {
        await redis.set(key, serialized, 'EX', SESSION_TTL);
    } catch (err) {
        console.error('[Redis] setSession error:', err.message);
        // fallback local
        inMemoryFallback.set(key, serialized);
    }
}

async function clearSession(clientId, jid) {
    const redis = getClient();
    const key = sessionKey(clientId, jid);

    if (!redis) {
        inMemoryFallback.delete(key);
        return;
    }

    try {
        await redis.del(key);
    } catch (err) {
        console.error('[Redis] clearSession error:', err.message);
    }
}

async function pauseSession(clientId, jid) {
    const redis = getClient();
    const key = pauseKey(clientId, jid);

    if (!redis) {
        inMemoryFallback.set(key, '1');
        return;
    }

    try {
        await redis.set(key, '1', 'EX', SESSION_TTL);
    } catch (err) {
        console.error('[Redis] pauseSession error:', err.message);
    }
}

async function resumeSession(clientId, jid) {
    const redis = getClient();
    const key = pauseKey(clientId, jid);

    if (!redis) {
        inMemoryFallback.delete(key);
        return;
    }

    try {
        await redis.del(key);
    } catch (err) {
        console.error('[Redis] resumeSession error:', err.message);
    }
}

async function isSessionPaused(clientId, jid) {
    const redis = getClient();
    const key = pauseKey(clientId, jid);

    if (!redis) {
        return inMemoryFallback.has(key);
    }

    try {
        const val = await redis.get(key);
        return val === '1';
    } catch (err) {
        console.error('[Redis] isSessionPaused error:', err.message);
        return false;
    }
}

// ── REGRAS DINÂMICAS (Contexto Global Admin) ─────────────────────────────────

async function getDynamicRules(clientId) {
    const redis = getClient();
    const key = rulesKey(clientId);

    if (!redis) {
        const val = inMemoryFallback.get(key);
        return val ? JSON.parse(val) : [];
    }

    try {
        const val = await redis.get(key);
        return val ? JSON.parse(val) : [];
    } catch (err) {
        console.error('[Redis] getDynamicRules error:', err.message);
        return [];
    }
}

async function setDynamicRules(clientId, rules) {
    const redis = getClient();
    const key = rulesKey(clientId);
    const serialized = JSON.stringify(rules);

    if (!redis) {
        inMemoryFallback.set(key, serialized);
        return;
    }

    try {
        await redis.set(key, serialized, 'EX', RULES_TTL);
    } catch (err) {
        console.error('[Redis] setDynamicRules error:', err.message);
        inMemoryFallback.set(key, serialized);
    }
}

async function clearDynamicRules(clientId) {
    const redis = getClient();
    const key = rulesKey(clientId);

    if (!redis) {
        inMemoryFallback.delete(key);
        return;
    }

    try {
        await redis.del(key);
    } catch (err) {
        console.error('[Redis] clearDynamicRules error:', err.message);
    }
}

// ── STANDBY GLOBAL DO BOT ─────────────────────────────────────────────────────
// Desliga/liga o bot inteiro para um clientId (ignora todos os clientes enquanto ativo)

async function setBotStandby(clientId, active) {
    const redis = getClient();
    const key = standbyKey(clientId);

    if (!redis) {
        if (active) inMemoryFallback.set(key, '1');
        else inMemoryFallback.delete(key);
        return;
    }

    try {
        if (active) {
            await redis.set(key, '1'); // sem expiração — só desliga com comando
        } else {
            await redis.del(key);
        }
    } catch (err) {
        console.error('[Redis] setBotStandby error:', err.message);
    }
}

async function isBotOnStandby(clientId) {
    const redis = getClient();
    const key = standbyKey(clientId);

    if (!redis) {
        return inMemoryFallback.has(key);
    }

    try {
        const val = await redis.get(key);
        return val === '1';
    } catch (err) {
        console.error('[Redis] isBotOnStandby error:', err.message);
        return false;
    }
}

async function getOnboardingState(clientId, jid) {
    const redis = getClient();
    const key = `onboarding:${clientId}:${jid}`;
    if (!redis) {
        const val = inMemoryFallback.get(key);
        return val ? JSON.parse(val) : null;
    }
    try {
        const val = await redis.get(key);
        return val ? JSON.parse(val) : null;
    } catch (err) {
        console.error('[Redis] getOnboardingState error:', err.message);
        return null;
    }
}

async function setOnboardingState(clientId, jid, state) {
    const redis = getClient();
    const key = `onboarding:${clientId}:${jid}`;
    const serialized = JSON.stringify(state);
    if (!redis) {
        inMemoryFallback.set(key, serialized);
        return;
    }
    try {
        await redis.set(key, serialized, 'EX', SESSION_TTL);
    } catch (err) {
        console.error('[Redis] setOnboardingState error:', err.message);
        inMemoryFallback.set(key, serialized);
    }
}

// ── INTERACTION LOG (AIDA) ───────────────────────────────────────────────────
async function logInteraction(clientId, jid, entry) {
    const redis = getClient();
    const key = `log:${clientId}:${jid}`;
    const LOG_TTL = 60 * 60 * 24 * 30; // 30 dias
    try {
        if (!redis) return;
        const existing = await redis.get(key);
        const log = existing ? JSON.parse(existing) : [];
        log.push({ ...entry, ts: new Date().toISOString() });
        if (log.length > 200) log.splice(0, log.length - 200);
        await redis.set(key, JSON.stringify(log), 'EX', LOG_TTL);
    } catch (err) {
        console.error('[Redis] logInteraction error:', err.message);
    }
}

async function getInteractionLog(clientId, jid) {
    const redis = getClient();
    const key = `log:${clientId}:${jid}`;
    try {
        if (!redis) return [];
        const val = await redis.get(key);
        return val ? JSON.parse(val) : [];
    } catch (err) {
        console.error('[Redis] getInteractionLog error:', err.message);
        return [];
    }
}

async function setLastActivity(clientId, jid) {
    const redis = getClient();
    const key = `lastactivity:${clientId}:${jid}`;
    try {
        if (!redis) { inMemoryFallback.set(key, Date.now().toString()); return; }
        await redis.set(key, Date.now().toString(), 'EX', 3600);
    } catch (err) {
        console.error('[Redis] setLastActivity error:', err.message);
    }
}

async function getLastActivity(clientId, jid) {
    const redis = getClient();
    const key = `lastactivity:${clientId}:${jid}`;
    try {
        if (!redis) { const v = inMemoryFallback.get(key); return v ? parseInt(v) : null; }
        const val = await redis.get(key);
        return val ? parseInt(val) : null;
    } catch (err) {
        console.error('[Redis] getLastActivity error:', err.message);
        return null;
    }
}

// ── GAPS NOTEBOOK (AIDA) ─────────────────────────────────────────────────────
async function saveGaps(clientId, jid, gapsArray) {
    const redis = getClient();
    const key = `gaps:${clientId}:${jid}`;
    try {
        if (!redis) return;
        const existing = await redis.get(key);
        const gaps = existing ? JSON.parse(existing) : [];
        
        for (const gap of gapsArray) {
            gaps.push({ en: gap.en, pt: gap.pt, ts: new Date().toISOString() });
        }
        
        // Mantém os últimos 50 gaps
        if (gaps.length > 50) gaps.splice(0, gaps.length - 50);
        await redis.set(key, JSON.stringify(gaps), 'EX', 60 * 60 * 24 * 60); // 60 dias
    } catch (err) {
        console.error('[Redis] saveGaps error:', err.message);
    }
}

async function getGaps(clientId, jid) {
    const redis = getClient();
    const key = `gaps:${clientId}:${jid}`;
    try {
        if (!redis) return [];
        const val = await redis.get(key);
        return val ? JSON.parse(val) : [];
    } catch (err) {
        console.error('[Redis] getGaps error:', err.message);
        return [];
    }
}

module.exports = {
    getSession,
    setSession,
    clearSession,
    isSessionPaused,
    pauseSession,
    resumeSession,
    getDynamicRules,
    setDynamicRules,
    clearDynamicRules,
    isBotOnStandby,
    setBotStandby,
    getOnboardingState,
    setOnboardingState,
    logInteraction,
    getInteractionLog,
    setLastActivity,
    getLastActivity,
    saveGaps,
    getGaps
};
