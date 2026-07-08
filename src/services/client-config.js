const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const diff = require('deep-diff').diff;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('[ClientConfig-DB] Erro no pool:', err.message);
});

/**
 * Busca a configuração do cliente no PostgreSQL (lê da VIEW client_configs onde status='active'). Se não achar, faz fallback para o JSON estático.
 */
async function getClientConfig(clientId) {
    let config = null;

    try {
        const res = await pool.query('SELECT * FROM client_configs WHERE client_id = $1', [clientId]);
        if (res.rows[0]) {
            const row = res.rows[0];
            config = row.raw_config || {};
            
            if (row.business_name) config.name = row.business_name;
            if (row.tone) config.tone = row.tone;
            if (row.target_audience) config.targetAudience = row.target_audience;
            if (row.services && row.services.length > 0) config.services = row.services;
            if (row.business_rules && Object.keys(row.business_rules).length > 0) {
                config = { ...config, ...row.business_rules };
            }
            if (row.examples && row.examples.length > 0) config.examples = row.examples;
            
            config._clientId = clientId;
            config._source = 'database';
        }
    } catch (err) {
        console.warn(`[ClientConfig] Erro ao buscar DB para ${clientId}, caindo para JSON fallback.`, err.message);
    }

    if (!config) {
        const configPath = path.join(__dirname, '..', 'config', 'clients', `${clientId}.json`);
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config._clientId = clientId;
            config._source = 'file';
        }
    }

    return config;
}

async function getClientConfigHistory(clientId, limit = 10) {
    const res = await pool.query(
        'SELECT * FROM client_config_versions WHERE client_id = $1 ORDER BY version_number DESC LIMIT $2',
        [clientId, limit]
    );
    return res.rows;
}

async function approveVersion(clientId, versionNumber) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`UPDATE client_config_versions SET status = 'superseded' WHERE client_id = $1 AND status = 'active'`, [clientId]);
        const res = await client.query(`UPDATE client_config_versions SET status = 'active' WHERE client_id = $1 AND version_number = $2 RETURNING *`, [clientId, versionNumber]);
        
        await client.query(
            `INSERT INTO audit_log (actor_type, actor_id, action, target_client_id, diff) VALUES ($1, $2, $3, $4, $5)`,
            ['system', 'internal', 'approve_version', clientId, JSON.stringify({ version: versionNumber })]
        );
        await client.query('COMMIT');
        return res.rows[0];
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function rollbackToVersion(clientId, versionNumber) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const oldVersion = await client.query('SELECT * FROM client_config_versions WHERE client_id = $1 AND version_number = $2', [clientId, versionNumber]);
        if (!oldVersion.rows[0]) throw new Error('Version not found');
        const data = oldVersion.rows[0];
        
        const nextVerRes = await client.query('SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver FROM client_config_versions WHERE client_id = $1', [clientId]);
        const nextVer = nextVerRes.rows[0].next_ver;

        await client.query(`UPDATE client_config_versions SET status = 'superseded' WHERE client_id = $1 AND status = 'active'`, [clientId]);

        const insertRes = await client.query(
            `INSERT INTO client_config_versions (client_id, version_number, status, business_name, tone, services, target_audience, business_rules, examples, raw_config, source, manager_id)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12) RETURNING *`,
            [
                clientId, nextVer, 'active', data.business_name, data.tone, JSON.stringify(data.services), data.target_audience,
                JSON.stringify(data.business_rules), JSON.stringify(data.examples), JSON.stringify(data.raw_config), 'manager_panel_rollback', data.manager_id
            ]
        );

        await client.query(
            `INSERT INTO audit_log (actor_type, actor_id, action, target_client_id, diff) VALUES ($1, $2, $3, $4, $5)`,
            ['manager', data.manager_id || 'unknown', 'rollback_version', clientId, JSON.stringify({ rolledBackTo: versionNumber, newVersion: nextVer })]
        );
        
        await client.query('COMMIT');
        return insertRes.rows[0];
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

/**
 * Cria uma nova versão das configurações do cliente com status pending_review
 */
async function upsertClientConfig(clientId, payload) {
    const { businessName, tone, services, targetAudience, businessRules, examples, rawConfig, managerId } = payload;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const oldRes = await client.query(`SELECT * FROM client_config_versions WHERE client_id = $1 ORDER BY version_number DESC LIMIT 1`, [clientId]);
        let oldData = {};
        if (oldRes.rows.length > 0) {
            const od = oldRes.rows[0];
            oldData = {
                businessName: od.business_name,
                tone: od.tone,
                services: od.services,
                targetAudience: od.target_audience,
                businessRules: od.business_rules,
                examples: od.examples,
                rawConfig: od.raw_config
            };
        }

        const newData = { businessName, tone, services, targetAudience, businessRules, examples, rawConfig };
        const changes = diff(oldData, newData) || [];

        const nextVerRes = await client.query('SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver FROM client_config_versions WHERE client_id = $1', [clientId]);
        const nextVer = nextVerRes.rows[0].next_ver;

        const insertRes = await client.query(
            `INSERT INTO client_config_versions (client_id, version_number, status, business_name, tone, services, target_audience, business_rules, examples, raw_config, source, manager_id)
             VALUES ($1, $2, 'pending_review', $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11) RETURNING *`,
            [
                clientId, nextVer, businessName, tone || 'amigável', JSON.stringify(services || []), targetAudience || null,
                JSON.stringify(businessRules || {}), JSON.stringify(examples || []), JSON.stringify(rawConfig || {}), 'manager_panel', managerId || null
            ]
        );

        await client.query(
            `INSERT INTO audit_log (actor_type, actor_id, action, target_client_id, diff) VALUES ($1, $2, $3, $4, $5)`,
            ['manager', managerId || 'unknown', 'create_version', clientId, JSON.stringify(changes)]
        );

        await client.query('COMMIT');
        return insertRes.rows[0];
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = {
    getClientConfig,
    upsertClientConfig,
    getClientConfigHistory,
    approveVersion,
    rollbackToVersion
};
