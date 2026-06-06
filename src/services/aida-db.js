/**
 * AIDA — Serviço de Banco de Dados (PostgreSQL/Railway)
 * Dara (Data Engineer) × Dex (Dev) — Experia Solutions
 * 
 * Responsabilidades:
 * - Conexão ao PostgreSQL no Railway
 * - CRUD de students, sessions, conversation_log, acquisition_memory
 * - Substituição total do Google Sheets para AIDA
 */

const { Pool } = require('pg');

// Pool de conexões — Railway injeta DATABASE_URL automaticamente
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('[AIDA-DB] Erro inesperado no pool:', err.message);
});

// ── STUDENTS ──────────────────────────────────────────────────────────────────

async function getStudent(telegramId) {
    const res = await pool.query(
        'SELECT * FROM students WHERE telegram_id = $1',
        [telegramId]
    );
    return res.rows[0] || null;
}

async function createStudent(telegramId, nome) {
    const res = await pool.query(
        `INSERT INTO students (telegram_id, nome) 
         VALUES ($1, $2) 
         ON CONFLICT (telegram_id) DO UPDATE SET nome = EXCLUDED.nome, updated_at = NOW()
         RETURNING *`,
        [telegramId, nome]
    );
    return res.rows[0];
}

async function updateStudentProfile(telegramId, profile) {
    const { nivel_numerico, interesse, objetivo, disponibilidade, tom, tutor_nome } = profile;
    const res = await pool.query(
        `UPDATE students 
         SET nivel_numerico = $2::smallint,
             nivel = $2::text,
             interesse = $3,
             objetivo = $4,
             disponibilidade = $5::smallint,
             tom = $6,
             tutor_nome = $7,
             onboarding_completo = TRUE,
             onboarding_step = 5,
             updated_at = NOW()
         WHERE telegram_id = $1
         RETURNING *`,
        [telegramId, nivel_numerico, interesse, objetivo, disponibilidade, tom, tutor_nome]
    );
    return res.rows[0];
}

async function updateStudentAccess(telegramId) {
    // Incrementa sessoes_total apenas 1x por hora (evita contar cada mensagem como sessão)
    await pool.query(
        `UPDATE students 
         SET ultimo_acesso = NOW(),
             sessoes_total = CASE
                 WHEN ultimo_acesso IS NULL OR NOW() - ultimo_acesso > INTERVAL '1 hour'
                 THEN sessoes_total + 1
                 ELSE sessoes_total
             END,
             updated_at = NOW()
         WHERE telegram_id = $1`,
        [telegramId]
    );
}

async function updateStudentLevel(telegramId, newLevel) {
    await pool.query(
        `UPDATE students 
         SET nivel_numerico = $2::smallint, nivel = $2::text, updated_at = NOW()
         WHERE telegram_id = $1`,
        [telegramId, newLevel]
    );
}

async function updateStudentPhase(telegramId, fase) {
    await pool.query(
        `UPDATE students SET fase = $2, updated_at = NOW() WHERE telegram_id = $1`,
        [telegramId, fase]
    );
}

async function updateStudentMode(telegramId, modo) {
    await pool.query(
        `UPDATE students SET modo_atual = $2, updated_at = NOW() WHERE telegram_id = $1`,
        [telegramId, modo]
    );
}

async function getAllActiveStudents() {
    const res = await pool.query(
        `SELECT * FROM dashboard_gabriel ORDER BY dias_sem_acesso DESC`
    );
    return res.rows;
}

async function pauseStudent(telegramId, days) {
    const pauseUntil = new Date();
    pauseUntil.setDate(pauseUntil.getDate() + days);
    await pool.query(
        `UPDATE students 
         SET status = 'pausado', pausa_ate = $2, updated_at = NOW()
         WHERE telegram_id = $1`,
        [telegramId, pauseUntil]
    );
}

async function endStudent(telegramId) {
    await pool.query(
        `UPDATE students SET status = 'encerrado', updated_at = NOW() WHERE telegram_id = $1`,
        [telegramId]
    );
}

// ── SESSIONS (Memória de Conversa) ───────────────────────────────────────────

async function getSession(telegramId) {
    const res = await pool.query(
        `SELECT chat_history, cena_tipo, cena_contexto 
         FROM sessions 
         WHERE telegram_id = $1 AND sessao_ativa = TRUE 
         ORDER BY ultima_msg_em DESC 
         LIMIT 1`,
        [telegramId]
    );
    if (!res.rows[0]) return null;
    return {
        chatHistory: res.rows[0].chat_history,
        cenaTipo: res.rows[0].cena_tipo,
        cenaContexto: res.rows[0].cena_contexto,
    };
}

async function upsertSession(telegramId, chatHistory, cenaTipo = null, cenaContexto = null) {
    // Manter apenas últimas 20 mensagens + system prompt
    const bounded = chatHistory.length > 22
        ? [chatHistory[0], ...chatHistory.slice(-20)]
        : chatHistory;

    await pool.query(
        `INSERT INTO sessions (telegram_id, chat_history, cena_tipo, cena_contexto, ultima_msg_em)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (telegram_id) 
         DO UPDATE SET 
             chat_history = $2, 
             cena_tipo = $3, 
             cena_contexto = $4,
             ultima_msg_em = NOW(),
             updated_at = NOW()`,
        [telegramId, JSON.stringify(bounded), cenaTipo, cenaContexto]
    );
}

async function clearSession(telegramId) {
    await pool.query(
        `UPDATE sessions SET chat_history = '[]'::jsonb, cena_tipo = NULL, cena_contexto = NULL, updated_at = NOW()
         WHERE telegram_id = $1`,
        [telegramId]
    );
}

// ── CONVERSATION LOG ─────────────────────────────────────────────────────────

async function logMessage(telegramId, role, content, meta = {}) {
    const { cenaTipo, faseMomento, nivelMomento, producaoPalavras } = meta;

    // Sanitizar: remover tags <tts> do conteúdo antes de persistir no log
    const sanitizedContent = content ? content.replace(/<tts>[\s\S]*?<\/tts>/ig, (match) => {
        // mantém o texto mas sem as tags
        return match.replace(/<\/?tts>/ig, '');
    }) : content;

    const wordCount = role === 'user' && sanitizedContent
        ? sanitizedContent.split(/\s+/).filter(Boolean).length
        : null;

    await pool.query(
        `INSERT INTO conversation_log 
         (telegram_id, role, content, cena_tipo, fase_momento, nivel_momento, producao_palavras)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [telegramId, role, sanitizedContent, cenaTipo || null, faseMomento || null, nivelMomento || null, wordCount || producaoPalavras || null]
    );
}

async function getRecentMessages(telegramId, limit = 50) {
    const res = await pool.query(
        `SELECT role, content, producao_palavras, sinal_aquisicao, created_at
         FROM conversation_log
         WHERE telegram_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [telegramId, limit]
    );
    return res.rows.reverse();
}

async function getAverageWordCount(telegramId, lastNSessions = 5) {
    const res = await pool.query(
        `SELECT AVG(producao_palavras) as avg_words
         FROM (
             SELECT producao_palavras
             FROM conversation_log
             WHERE telegram_id = $1 AND role = 'user' AND producao_palavras IS NOT NULL
             ORDER BY created_at DESC
             LIMIT $2
         ) sub`,
        [telegramId, lastNSessions * 5] // ~5 msgs per session
    );
    return parseFloat(res.rows[0]?.avg_words || 0);
}

// ── ACQUISITION MEMORY ───────────────────────────────────────────────────────

async function getAcquisitionMemory(telegramId) {
    const res = await pool.query(
        `SELECT * FROM acquisition_memory WHERE telegram_id = $1 ORDER BY updated_at DESC`,
        [telegramId]
    );
    return res.rows;
}

async function introduceStructure(telegramId, estruturaTecnica, descricaoSimples, exemploIntroducao) {
    await pool.query(
        `INSERT INTO acquisition_memory 
         (telegram_id, estrutura_tecnica, descricao_simples, exemplo_introducao)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (telegram_id, estrutura_tecnica) DO NOTHING`,
        [telegramId, estruturaTecnica, descricaoSimples, exemploIntroducao]
    );
}

async function registerAcquisitionOccurrence(telegramId, estruturaTecnica, isEspontanea = false) {
    if (isEspontanea) {
        // Uso espontâneo — pode promover para 'adquirida'
        const res = await pool.query(
            `UPDATE acquisition_memory
             SET total_ocorrencias = total_ocorrencias + 1,
                 ocorrencias_espontaneas = ocorrencias_espontaneas + 1,
                 ultima_ocorrencia = NOW(),
                 status = CASE 
                     WHEN ocorrencias_espontaneas + 1 >= 2 THEN 'adquirida'
                     ELSE 'em_processo'
                 END,
                 adquirida_em = CASE 
                     WHEN ocorrencias_espontaneas + 1 >= 2 AND status != 'adquirida' THEN NOW()
                     ELSE adquirida_em
                 END,
                 updated_at = NOW()
             WHERE telegram_id = $1 AND estrutura_tecnica = $2
             RETURNING status`,
            [telegramId, estruturaTecnica]
        );

        // Se acabou de adquirir, incrementa contador no student
        if (res.rows[0]?.status === 'adquirida') {
            await pool.query(
                `UPDATE students SET estruturas_adquiridas = estruturas_adquiridas + 1, updated_at = NOW()
                 WHERE telegram_id = $1`,
                [telegramId]
            );
        }
    } else {
        await pool.query(
            `UPDATE acquisition_memory
             SET total_ocorrencias = total_ocorrencias + 1,
                 ultima_ocorrencia = NOW(),
                 status = CASE WHEN status = 'nova' THEN 'em_processo' ELSE status END,
                 updated_at = NOW()
             WHERE telegram_id = $1 AND estrutura_tecnica = $2`,
            [telegramId, estruturaTecnica]
        );
    }
}

async function getAcquisitionSummary(telegramId) {
    const res = await pool.query(
        `SELECT
             COUNT(*) FILTER (WHERE status = 'adquirida') as adquiridas,
             COUNT(*) FILTER (WHERE status = 'em_processo') as em_processo,
             COUNT(*) FILTER (WHERE status = 'nova') as novas,
             COUNT(*) as total,
             ROUND(COUNT(*) FILTER (WHERE status = 'adquirida')::numeric / NULLIF(COUNT(*), 0) * 100, 1) as pct_adquiridas
         FROM acquisition_memory
         WHERE telegram_id = $1`,
        [telegramId]
    );
    return res.rows[0];
}

// ── ONBOARDING ────────────────────────────────────────────────────────────────

async function getOnboardingState(telegramId) {
    const res = await pool.query(
        `SELECT * FROM onboarding_sessions WHERE telegram_id = $1`,
        [telegramId]
    );
    return res.rows[0] || null;
}

async function updateOnboardingStep(telegramId, step, respostas) {
    await pool.query(
        `INSERT INTO onboarding_sessions (telegram_id, step_atual, respostas)
         VALUES ($1, $2, $3)
         ON CONFLICT (telegram_id) 
         DO UPDATE SET step_atual = $2, respostas = $3, updated_at = NOW()`,
        [telegramId, step, JSON.stringify(respostas)]
    );
}

async function completeOnboarding(telegramId) {
    await pool.query(
        `UPDATE onboarding_sessions SET completo = TRUE, updated_at = NOW() WHERE telegram_id = $1`,
        [telegramId]
    );
}

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────

async function healthCheck() {
    try {
        await pool.query('SELECT 1');
        return { ok: true, message: 'PostgreSQL conectado' };
    } catch (err) {
        return { ok: false, message: err.message };
    }
}

module.exports = {
    // Students
    getStudent, createStudent, updateStudentProfile, updateStudentAccess,
    updateStudentLevel, updateStudentPhase, updateStudentMode,
    getAllActiveStudents, pauseStudent, endStudent,
    // Sessions
    getSession, upsertSession, clearSession,
    // Logs
    logMessage, getRecentMessages, getAverageWordCount,
    // Acquisition Memory
    getAcquisitionMemory, introduceStructure, registerAcquisitionOccurrence, getAcquisitionSummary,
    // Onboarding
    getOnboardingState, updateOnboardingStep, completeOnboarding,
    // Utils
    healthCheck,
    // NOTA: pool NÃO é exportado intencionalmente — use as funções acima
};
