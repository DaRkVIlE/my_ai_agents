const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../services/manager-db');
const redis = require('../services/redis');

const router = express.Router();

// Helper para obter tokens atuais
const getTokens = () => ({
    service: process.env.KAIROS_INTERNAL_SERVICE_TOKEN || 'local-service-token',
    scope: process.env.KAIROS_TENANT_SCOPE_SECRET || 'local-scope-secret',
    admin: process.env.KAIROS_INTERNAL_ADMIN_TOKEN || 'local-admin-token'
});

// Middleware para verificar Service Token
function verifyServiceToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    
    const token = authHeader.split(' ')[1];
    const tokens = getTokens();
    
    if (token === tokens.admin) {
        req.isAdminToken = true;
        return next();
    }
    
    if (token !== tokens.service) {
        return res.status(401).json({ error: 'Invalid service token' });
    }
    
    req.isAdminToken = false;
    next();
}

// Middleware para verificar X-Tenant-Scope
function verifyTenantScope(req, res, next) {
    if (req.isAdminToken) return next(); // Admin token ignora scope
    
    const scopeToken = req.headers['x-tenant-scope'];
    if (!scopeToken) {
        return res.status(403).json({ error: 'Missing X-Tenant-Scope header' });
    }
    
    const targetTenant = req.params.tenantId;
    if (!targetTenant) {
        return res.status(400).json({ error: 'No tenantId in route params' });
    }
    
    try {
        const decoded = jwt.verify(scopeToken, getTokens().scope);
        if (decoded.tenant_id !== targetTenant) {
            return res.status(403).json({ error: 'Scope mismatch: token does not authorize this tenant' });
        }
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired X-Tenant-Scope token', details: err.message });
    }
}

// GET /tenants/:tenantId/config
router.get('/tenants/:tenantId/config', verifyServiceToken, verifyTenantScope, async (req, res) => {
    try {
        const tenantId = req.params.tenantId;
        const config = await db.getInternalConfig(tenantId);
        if (!config || !config.profile) {
            return res.status(404).json({ error: 'Tenant config not found' });
        }
        res.status(200).json(config);
    } catch (err) {
        console.error(`[Internal API] GET config error: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /tenants/:tenantId/config
router.put('/tenants/:tenantId/config', verifyServiceToken, verifyTenantScope, async (req, res) => {
    try {
        const tenantId = req.params.tenantId;
        const { expected_version, profile, bot_config } = req.body;
        
        if (expected_version === undefined) {
            return res.status(422).json({ error: 'Missing expected_version' });
        }
        
        const nextVersion = await db.saveInternalConfigDraft(tenantId, expected_version, profile, bot_config);
        
        res.status(200).json({
            tenant_id: tenantId,
            version: nextVersion,
            status: 'draft'
        });
    } catch (err) {
        if (err.message.startsWith('CONFLICT:')) {
            return res.status(409).json({ error: err.message });
        }
        console.error(`[Internal API] PUT config error: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /tenants/:tenantId/publish
router.post('/tenants/:tenantId/publish', verifyServiceToken, verifyTenantScope, async (req, res) => {
    try {
        const tenantId = req.params.tenantId;
        const { version } = req.body;
        
        if (version === undefined) {
            return res.status(422).json({ error: 'Missing version' });
        }
        
        const publishedBy = 'system'; // TODO: decodificar do X-Tenant-Scope se necessário
        
        const publishedAt = await db.publishInternalConfig(tenantId, version, publishedBy);
        
        res.status(200).json({
            tenant_id: tenantId,
            version: version,
            status: 'live',
            published_at: publishedAt,
            published_by: publishedBy
        });
    } catch (err) {
        if (err.message === "Draft not found for this version") {
            return res.status(409).json({ error: err.message });
        }
        console.error(`[Internal API] POST publish error: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /tenants/:tenantId/status
router.get('/tenants/:tenantId/status', verifyServiceToken, verifyTenantScope, async (req, res) => {
    try {
        const tenantId = req.params.tenantId;
        
        // Pega última config
        const lastPublish = await db.getLastPublish(tenantId);
        const lastVersion = lastPublish ? lastPublish.version : null;
        
        // Verifica standby e status
        const isStandby = await redis.isBotOnStandby(tenantId);
        
        res.status(200).json({
            tenant_id: tenantId,
            evolution_session: isStandby ? "paused" : "connected",
            queue_depth: null, // Mock por enquanto
            last_message_processed_at: null,
            last_published_version: lastVersion,
            degraded: false
        });
    } catch (err) {
        console.error(`[Internal API] GET status error: ${err.message}`);
        res.status(200).json({
            tenant_id: req.params.tenantId,
            evolution_session: "unknown",
            queue_depth: null,
            last_message_processed_at: null,
            last_published_version: null,
            degraded: true,
            degraded_reason: err.message
        });
    }
});

// GET /tenants
router.get('/tenants', verifyServiceToken, async (req, res) => {
    try {
        if (!req.isAdminToken) {
            return res.status(403).json({ error: 'Admin scope required' });
        }
        
        const tenants = await db.getAllTenantsInternal();
        res.status(200).json({ tenants });
    } catch (err) {
        console.error(`[Internal API] GET tenants error: ${err.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
