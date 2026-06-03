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

function sessionKey(clientId, jid) {
    return `session:${clientId}:${jid}`;
}

function pauseKey(clientId, jid) {
    return `paused:${clientId}:${jid}`;
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

module.exports = {
    getSession,
    setSession,
    clearSession,
    pauseSession,
    resumeSession,
    isSessionPaused,
};
