/**
 * KAIROS Railway Backup Script
 * Faz backup completo do PostgreSQL e Redis via Node.js
 * Não depende de pg_dump ou redis-cli instalados localmente
 */

const { Client } = require('pg');
const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = 'C:\\Users\\GABS\\Documents\\My KAIROS\\backups\\railway-2026-06-04';

// Garantir que o diretório existe
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

// ── Credenciais (URLs públicas do Railway) ────────────────────────────────────
const PG_URL = 'postgresql://postgres:BqzJwckBYGxIzjefxWEKTQdcPkRmFJOR@kodama.proxy.rlwy.net:53788/railway';
const REDIS_URL = 'redis://default:xViFOZaXFKjCDoOQkuqcaXSRhWqFAvHD@kodama.proxy.rlwy.net:17034';
const EVOLUTION_URL = 'https://evolution-api-production-9afd.up.railway.app';
const EVOLUTION_KEY = '0796694f6624b803eb24c74465dfc399e9cb39e209c65c289ad7b6b3fb83b412';

// ── PostgreSQL Backup ─────────────────────────────────────────────────────────
async function backupPostgres() {
    console.log('\n📦 [PostgreSQL] Iniciando backup...');
    const client = new Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        console.log('[PostgreSQL] Conectado.');

        // Lista todas as tabelas
        const tablesRes = await client.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);
        const tables = tablesRes.rows.map(r => r.table_name);
        console.log(`[PostgreSQL] Tabelas encontradas: ${tables.join(', ')}`);

        const backup = {
            exported_at: new Date().toISOString(),
            database: 'railway',
            tables: {}
        };

        for (const table of tables) {
            try {
                // Pegar schema da tabela
                const schemaRes = await client.query(`
                    SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = $1
                    ORDER BY ordinal_position;
                `, [table]);

                // Pegar dados
                const dataRes = await client.query(`SELECT * FROM "${table}"`);
                
                backup.tables[table] = {
                    schema: schemaRes.rows,
                    row_count: dataRes.rows.length,
                    data: dataRes.rows
                };
                console.log(`[PostgreSQL] ✓ ${table}: ${dataRes.rows.length} registros`);
            } catch (err) {
                console.error(`[PostgreSQL] ✗ Erro na tabela ${table}: ${err.message}`);
                backup.tables[table] = { error: err.message };
            }
        }

        // Salvar DDL (CREATE TABLE statements) via information_schema
        const ddlFile = path.join(BACKUP_DIR, `postgres_backup_${TIMESTAMP}.json`);
        fs.writeFileSync(ddlFile, JSON.stringify(backup, null, 2), 'utf8');
        
        const sizeMB = (fs.statSync(ddlFile).size / 1024 / 1024).toFixed(2);
        console.log(`[PostgreSQL] ✅ Backup salvo: ${ddlFile} (${sizeMB} MB)`);
        
    } catch (err) {
        console.error('[PostgreSQL] ❌ Falha:', err.message);
    } finally {
        await client.end();
    }
}

// ── Redis Backup ──────────────────────────────────────────────────────────────
async function backupRedis() {
    console.log('\n📦 [Redis] Iniciando backup...');
    const redis = new Redis(REDIS_URL, { 
        maxRetriesPerRequest: 3,
        connectTimeout: 15000,
        enableTLSForUnixSockets: false,
        lazyConnect: true
    });
    await redis.connect();

    try {
        await redis.ping();
        console.log('[Redis] Conectado.');

        // Info do servidor
        const info = await redis.info();
        const dbSizeRes = await redis.dbsize();
        console.log(`[Redis] Total de chaves: ${dbSizeRes}`);

        // Scan de todas as chaves
        const backup = {
            exported_at: new Date().toISOString(),
            total_keys: dbSizeRes,
            server_info: info.split('\r\n').slice(0, 20).join('\n'),
            data: {}
        };

        let cursor = '0';
        let scannedKeys = 0;
        
        do {
            const result = await redis.scan(cursor, 'COUNT', 100);
            cursor = result[0];
            const keys = result[1];
            scannedKeys += keys.length;

            for (const key of keys) {
                const type = await redis.type(key);
                const ttl = await redis.ttl(key);
                
                let value;
                if (type === 'string') value = await redis.get(key);
                else if (type === 'hash') value = await redis.hgetall(key);
                else if (type === 'list') value = await redis.lrange(key, 0, -1);
                else if (type === 'set') value = await redis.smembers(key);
                else if (type === 'zset') value = await redis.zrange(key, 0, -1, 'WITHSCORES');
                else value = `[tipo não suportado: ${type}]`;

                backup.data[key] = { type, ttl, value };
            }
            
            process.stdout.write(`\r[Redis] Escaneando: ${scannedKeys}/${dbSizeRes} chaves...`);
        } while (cursor !== '0');

        console.log('');
        const redisFile = path.join(BACKUP_DIR, `redis_backup_${TIMESTAMP}.json`);
        fs.writeFileSync(redisFile, JSON.stringify(backup, null, 2), 'utf8');
        
        const sizeMB = (fs.statSync(redisFile).size / 1024 / 1024).toFixed(2);
        console.log(`[Redis] ✅ Backup salvo: ${redisFile} (${sizeMB} MB)`);

    } catch (err) {
        console.error('[Redis] ❌ Falha:', err.message);
    } finally {
        redis.disconnect();
    }
}

// ── Evolution API Backup ──────────────────────────────────────────────────────
async function backupEvolution() {
    console.log('\n📦 [Evolution API] Iniciando backup das instâncias...');
    
    try {
        // Usando fetch nativo do Node 18+
        const headers = { 'apikey': EVOLUTION_KEY, 'Content-Type': 'application/json' };

        // Listar todas as instâncias
        const instancesRes = await fetch(`${EVOLUTION_URL}/instance/fetchInstances`, { headers });
        if (!instancesRes.ok) throw new Error(`HTTP ${instancesRes.status}`);
        const instances = await instancesRes.json();

        console.log(`[Evolution] Instâncias encontradas: ${instances.length}`);

        const backup = {
            exported_at: new Date().toISOString(),
            evolution_url: EVOLUTION_URL,
            instances: []
        };

        for (const inst of instances) {
            const instName = inst.instance?.instanceName || inst.name;
            console.log(`[Evolution] Coletando: ${instName}...`);
            
            const instBackup = { 
                instance: inst,
                settings: null,
                webhooks: null,
                contacts: null
            };

            // Settings
            try {
                const settingsRes = await fetch(`${EVOLUTION_URL}/settings/find/${instName}`, { headers });
                if (settingsRes.ok) instBackup.settings = await settingsRes.json();
            } catch (e) { instBackup.settings = { error: e.message }; }

            // Webhook config
            try {
                const webhookRes = await fetch(`${EVOLUTION_URL}/webhook/find/${instName}`, { headers });
                if (webhookRes.ok) instBackup.webhooks = await webhookRes.json();
            } catch (e) { instBackup.webhooks = { error: e.message }; }

            backup.instances.push(instBackup);
        }

        const evolFile = path.join(BACKUP_DIR, `evolution_backup_${TIMESTAMP}.json`);
        fs.writeFileSync(evolFile, JSON.stringify(backup, null, 2), 'utf8');
        console.log(`[Evolution] ✅ Backup salvo: ${evolFile}`);

    } catch (err) {
        console.error('[Evolution] ❌ Falha:', err.message);
    }
}

// ── Sumário ───────────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀 KAIROS Railway Backup — Iniciado em', new Date().toLocaleString('pt-BR'));
    console.log(`📁 Destino: ${BACKUP_DIR}\n`);

    await backupPostgres();
    await backupRedis();
    await backupEvolution();

    // Gerar sumário
    const files = fs.readdirSync(BACKUP_DIR).map(f => {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        return `  ${f.padEnd(60)} ${(stats.size / 1024).toFixed(1)} KB`;
    });

    const summary = [
        '='.repeat(70),
        'KAIROS RAILWAY BACKUP — SUMÁRIO',
        `Data: ${new Date().toLocaleString('pt-BR')}`,
        '='.repeat(70),
        '',
        'Arquivos gerados:',
        ...files,
        '',
        'Credenciais de Restauração:',
        `  PostgreSQL: postgresql://postgres:BqzJwckBYGxIzjefxWEKTQdcPkRmFJOR@[NOVO_HOST]/railway`,
        `  Redis:      redis://default:xViFOZaXFKjCDoOQkuqcaXSRhWqFAvHD@[NOVO_HOST]/0`,
        `  Evolution:  ${EVOLUTION_URL}`,
        '',
        'Para restaurar PostgreSQL:',
        '  1. Crie novo serviço Postgres no Railway/Render/Supabase',
        '  2. Execute restore_postgres.js com a nova connection string',
        '  3. Atualize DATABASE_CONNECTION_URI na Evolution API',
        '',
        '='.repeat(70),
    ].join('\n');

    fs.writeFileSync(path.join(BACKUP_DIR, 'SUMARIO.txt'), summary, 'utf8');
    console.log('\n' + summary);
    console.log('\n✅ Backup completo!');
}

main().catch(console.error);
