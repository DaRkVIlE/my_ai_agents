const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getClientConfig, upsertClientConfig, getClientConfigHistory, approveVersion, rollbackToVersion } = require('../services/client-config');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Middleware para verificar o Secret Interno
function requireInternalSecret(req, res, next) {
    const secret = req.headers['x-internal-secret'];
    if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
        return res.status(403).json({ error: 'Forbidden: Invalid or missing internal secret' });
    }
    next();
}

function verifyHMAC(managerId, clientId, timestamp, signature) {
    if (!signature) return false;
    // Evita replay attacks (max 5 min de diferença)
    const now = Date.now();
    if (Math.abs(now - parseInt(timestamp)) > 5 * 60 * 1000) return false;

    const hmac = crypto.createHmac('sha256', process.env.INTERNAL_API_SECRET);
    hmac.update(`${managerId}:${clientId}:${timestamp}`);
    const expected = hmac.digest('hex');
    
    // Time-safe comparison
    try {
        return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
    } catch(e) {
        return false;
    }
}

// Heurísticas de injeção
function containsPromptInjection(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    const patterns = [
        "ignore as instruções anteriores",
        "ignore previous instructions",
        "você agora é",
        "you are now",
        "system:",
        "assistant:",
        "desconsidere tudo",
        "novo prompt"
    ];
    return patterns.some(p => lower.includes(p));
}

router.use(requireInternalSecret);

// Recebe calibração do Painel de Gestão
router.post('/calibrate', async (req, res) => {
    try {
        const timestamp = req.headers['x-timestamp'];
        const signature = req.headers['x-signature'];
        const { clientId, businessName, tone, targetAudience, services, businessRules, examples, rawConfig, managerId } = req.body;
        
        if (!clientId || !managerId) {
            return res.status(400).json({ error: 'clientId and managerId are required' });
        }

        // STORY 3: Validação de Assinatura HMAC
        if (!verifyHMAC(managerId, clientId, timestamp, signature)) {
            return res.status(403).json({ error: 'Invalid HMAC signature or expired timestamp' });
        }

        // STORY 5: Sanitização de conteúdo e limite de tamanho
        const strBusinessRules = JSON.stringify(businessRules || {});
        if (strBusinessRules.length > 2000) {
            return res.status(400).json({ error: 'businessRules exceeds 2000 characters' });
        }
        if (examples && Array.isArray(examples)) {
            if (examples.length > 10) return res.status(400).json({ error: 'examples exceed maximum of 10' });
            for (let ex of examples) {
                if (JSON.stringify(ex).length > 500) {
                    return res.status(400).json({ error: 'an example exceeds 500 characters' });
                }
            }
        }

        let isInjection = false;
        if (containsPromptInjection(strBusinessRules) || containsPromptInjection(JSON.stringify(examples))) {
            isInjection = true;
        }

        // Prepara os dados.
        const mergedRawConfig = { ...rawConfig, name: businessName || rawConfig?.name || clientId };

        const versionData = await upsertClientConfig(clientId, {
            businessName: businessName || clientId,
            tone,
            targetAudience,
            services,
            businessRules,
            examples,
            rawConfig: mergedRawConfig,
            managerId
        });

        // Se for injection, rejeita a versão criada imediatamente
        if (isInjection) {
            await pool.query(`UPDATE client_config_versions SET status = 'rejected' WHERE id = $1`, [versionData.id]);
            await pool.query(
                `INSERT INTO audit_log (actor_type, actor_id, action, target_client_id, diff) VALUES ($1, $2, $3, $4, $5)`,
                ['system', 'security_module', 'reject_version_injection', clientId, JSON.stringify({ reason: 'prompt_injection_detected', version: versionData.version_number })]
            );
            return res.status(400).json({ error: 'Prompt injection detected. Calibration rejected and logged.' });
        }

        res.status(200).json({ success: true, version: versionData.version_number, status: versionData.status, message: `Calibration created. Pending review.` });
    } catch (error) {
        console.error('[Internal Manager API] Erro ao calibrar:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Puxar calibração atual do runtime
router.get('/config/:clientId', async (req, res) => {
    try {
        const config = await getClientConfig(req.params.clientId);
        if (!config) {
            return res.status(404).json({ error: 'Client not found' });
        }
        res.status(200).json(config);
    } catch (error) {
        console.error('[Internal Manager API] Erro ao buscar config:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Puxar histórico de versões
router.get('/config/:clientId/history', async (req, res) => {
    try {
        const history = await getClientConfigHistory(req.params.clientId);
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Puxar log de auditoria
router.get('/audit/:clientId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM audit_log WHERE target_client_id = $1 ORDER BY created_at DESC LIMIT 50', [req.params.clientId]);
        res.status(200).json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Aprovar uma versão
router.post('/config/:clientId/approve/:versionNumber', async (req, res) => {
    try {
        const version = await approveVersion(req.params.clientId, parseInt(req.params.versionNumber));
        res.status(200).json({ success: true, version });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error approving version' });
    }
});

// Rollback para versão antiga
router.post('/config/:clientId/rollback/:versionNumber', async (req, res) => {
    try {
        const version = await rollbackToVersion(req.params.clientId, parseInt(req.params.versionNumber));
        res.status(200).json({ success: true, newVersion: version.version_number });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error rolling back' });
    }
});

module.exports = router;
