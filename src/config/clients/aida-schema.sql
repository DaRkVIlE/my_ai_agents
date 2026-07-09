-- ================================================================
-- AIDA — Aquisição Imersiva Dinâmica Acelerada
-- PostgreSQL Schema (Railway)
-- Dara (Data Engineer) — Experia Solutions
-- ================================================================

-- ── EXTENSÕES ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Para busca fuzzy futura

-- ================================================================
-- TABELA: students
-- Perfil completo de cada aluno AIDA
-- ================================================================
CREATE TABLE IF NOT EXISTS students (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id     BIGINT UNIQUE NOT NULL,
    nome            VARCHAR(100),

    -- Perfil linguístico
    nivel           VARCHAR(20) NOT NULL DEFAULT 'unknown'
                    CHECK (nivel IN ('unknown','1','2','3','4','5','6','7','8','9','10')),
    nivel_numerico  SMALLINT NOT NULL DEFAULT 3 CHECK (nivel_numerico BETWEEN 1 AND 10),

    -- Perfil pessoal (coletado no onboarding)
    interesse       VARCHAR(20) NOT NULL DEFAULT 'general'
                    CHECK (interesse IN ('tech','sports','travel','business','culture','general')),
    objetivo        VARCHAR(20) NOT NULL DEFAULT 'general'
                    CHECK (objetivo IN ('work','travel','study','culture','general')),
    disponibilidade SMALLINT NOT NULL DEFAULT 15, -- minutos por dia
    tom             VARCHAR(10) NOT NULL DEFAULT 'neutral'
                    CHECK (tom IN ('informal','neutral','formal')),

    -- Tutor atribuído (baseado no interesse)
    tutor_nome      VARCHAR(50),

    -- Perfil MANA (P1-P4) — determina a estratégia de abertura e ritmo de progressão
    perfil_mana     VARCHAR(20) NOT NULL DEFAULT 'travado'
                    CHECK (perfil_mana IN ('zero','travado','especialista','multilingue')),

    -- Idioma-alvo (usado por P4 Multilíngue)
    idioma_alvo     VARCHAR(30) NOT NULL DEFAULT 'ingles',

    -- Triagem MANA concluída (false = perfil inferido, true = diagnosticado)
    triagem_completa BOOLEAN NOT NULL DEFAULT FALSE,

    -- Fase do método
    fase            VARCHAR(20) NOT NULL DEFAULT 'descongelamento'
                    CHECK (fase IN ('descongelamento','fluxo','fluencia')),

    -- Métricas de progresso
    sessoes_total       INTEGER NOT NULL DEFAULT 0,
    sessoes_streak      INTEGER NOT NULL DEFAULT 0,  -- dias consecutivos
    estruturas_adquiridas INTEGER NOT NULL DEFAULT 0,

    -- Estado operacional
    status          VARCHAR(20) NOT NULL DEFAULT 'trial'
                    CHECK (status IN ('trial','ativo','pausado','encerrado')),
    pausa_ate       TIMESTAMP WITH TIME ZONE,

    -- Modo atual (imersão ou dúvida)
    modo_atual      VARCHAR(15) NOT NULL DEFAULT 'imersao'
                    CHECK (modo_atual IN ('imersao','duvida')),

    -- Onboarding
    onboarding_completo BOOLEAN NOT NULL DEFAULT FALSE,
    onboarding_step     SMALLINT NOT NULL DEFAULT 0,

    -- Timestamps
    primeiro_acesso TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ultimo_acesso   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices de students
CREATE INDEX IF NOT EXISTS idx_students_telegram_id ON students(telegram_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_interesse ON students(interesse);
CREATE INDEX IF NOT EXISTS idx_students_ultimo_acesso ON students(ultimo_acesso DESC);

-- Comentários
COMMENT ON TABLE students IS 'Perfil completo de cada aluno do sistema AIDA/MANA';
COMMENT ON COLUMN students.nivel_numerico IS '1=Iniciante completo, 5=Intermediário, 10=Nativo';
COMMENT ON COLUMN students.fase IS 'Fase do método MANA: descongelamento → fluxo → fluência';
COMMENT ON COLUMN students.modo_atual IS 'imersao=prática contextual | duvida=perguntas sobre método/idioma';

-- ================================================================
-- TABELA: sessions
-- Memória de conversa por sessão (substitui Redis para persistência)
-- Redis ainda pode ser usado para cache de sessão ativa
-- ================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id     BIGINT UNIQUE NOT NULL REFERENCES students(telegram_id) ON DELETE CASCADE,

    -- Histórico de mensagens como JSONB (compatível com formato OpenAI)
    chat_history    JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Cena atual em andamento
    cena_tipo       VARCHAR(30),
    cena_contexto   TEXT, -- Descrição da cena atual para continuidade

    -- Estado da sessão
    sessao_ativa    BOOLEAN NOT NULL DEFAULT TRUE,
    iniciada_em     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ultima_msg_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_telegram_id ON sessions(telegram_id);
CREATE INDEX IF NOT EXISTS idx_sessions_ativa ON sessions(sessao_ativa) WHERE sessao_ativa = TRUE;

COMMENT ON TABLE sessions IS 'Memória de conversa ativa por aluno. Uma sessão por aluno a qualquer momento.';
COMMENT ON COLUMN sessions.chat_history IS 'Array de mensagens no formato [{role, content}] compatível com OpenAI/Groq';

-- ================================================================
-- TABELA: conversation_log
-- Log imutável de todas as interações (auditoria + análise)
-- ================================================================
CREATE TABLE IF NOT EXISTS conversation_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id     BIGINT NOT NULL REFERENCES students(telegram_id) ON DELETE CASCADE,

    -- Conteúdo da mensagem
    role            VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant','system')),
    content         TEXT NOT NULL,

    -- Contexto pedagógico
    cena_tipo       VARCHAR(30),
    fase_momento    VARCHAR(20), -- fase do aluno no momento da mensagem
    nivel_momento   SMALLINT,    -- nível do aluno no momento

    -- Análise de aquisição (preenchida pelo engine assíncrono)
    sinal_aquisicao         BOOLEAN DEFAULT FALSE,
    estruturas_detectadas   TEXT[], -- Array de estruturas usadas espontaneamente
    producao_palavras       SMALLINT, -- Quantidade de palavras produzidas pelo aluno

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices de conversation_log
CREATE INDEX IF NOT EXISTS idx_conv_log_telegram_id ON conversation_log(telegram_id);
CREATE INDEX IF NOT EXISTS idx_conv_log_created_at ON conversation_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_log_sinal ON conversation_log(sinal_aquisicao) WHERE sinal_aquisicao = TRUE;
CREATE INDEX IF NOT EXISTS idx_conv_log_role ON conversation_log(role);

COMMENT ON TABLE conversation_log IS 'Log imutável de todas as interações. Fonte de verdade para análise de aquisição.';
COMMENT ON COLUMN conversation_log.sinal_aquisicao IS 'TRUE quando o aluno usou uma estrutura nova espontaneamente (= aquisição detectada)';

-- ================================================================
-- TABELA: acquisition_memory
-- Memória de aquisição — o diferencial IP do MANA
-- ================================================================
CREATE TABLE IF NOT EXISTS acquisition_memory (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id     BIGINT NOT NULL REFERENCES students(telegram_id) ON DELETE CASCADE,

    -- A estrutura linguística
    estrutura_tecnica   VARCHAR(100) NOT NULL, -- Ex: 'present_perfect', 'modal_could'
    descricao_simples   VARCHAR(200) NOT NULL, -- Ex: 'Falar de experiências de vida'
    exemplo_introducao  TEXT, -- Primeiro exemplo em que foi introduzida

    -- Status de aquisição
    status          VARCHAR(15) NOT NULL DEFAULT 'nova'
                    CHECK (status IN ('nova','em_processo','adquirida')),

    -- Evidência de aquisição
    evidencia_texto TEXT, -- Trecho da conversa que comprovou aquisição
    evidencia_msg_id UUID REFERENCES conversation_log(id),

    -- Histórico de ocorrências
    total_ocorrencias       INTEGER NOT NULL DEFAULT 0,
    ocorrencias_espontaneas INTEGER NOT NULL DEFAULT 0, -- Sem ser solicitado

    -- Timestamps
    introduzida_em  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    adquirida_em    TIMESTAMP WITH TIME ZONE, -- Preenchido quando status → adquirida
    ultima_ocorrencia TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(telegram_id, estrutura_tecnica)
);

CREATE INDEX IF NOT EXISTS idx_acq_mem_telegram_id ON acquisition_memory(telegram_id);
CREATE INDEX IF NOT EXISTS idx_acq_mem_status ON acquisition_memory(status);
CREATE INDEX IF NOT EXISTS idx_acq_mem_adquiridas ON acquisition_memory(telegram_id, status) WHERE status = 'adquirida';

COMMENT ON TABLE acquisition_memory IS 'Memória de aquisição — rastreia quais estruturas linguísticas cada aluno realmente adquiriu vs apenas praticou.';
COMMENT ON COLUMN acquisition_memory.status IS 'nova=introduzida | em_processo=usa quando solicitado | adquirida=uso espontâneo em contexto novo';

-- ================================================================
-- TABELA: onboarding_sessions
-- Estado do onboarding para alunos novos
-- ================================================================
CREATE TABLE IF NOT EXISTS onboarding_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_id     BIGINT UNIQUE NOT NULL,

    -- Progresso
    step_atual      SMALLINT NOT NULL DEFAULT 0, -- 0=início, 5=completo
    respostas       JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Estado
    completo        BOOLEAN NOT NULL DEFAULT FALSE,
    abandonado      BOOLEAN NOT NULL DEFAULT FALSE,

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE onboarding_sessions IS 'Estado do onboarding de 5 perguntas para novos alunos.';

-- ================================================================
-- FUNCTION: update_updated_at()
-- Trigger para auto-update do campo updated_at
-- ================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger em todas as tabelas com updated_at
CREATE TRIGGER trg_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_acq_mem_updated_at
    BEFORE UPDATE ON acquisition_memory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_onboarding_updated_at
    BEFORE UPDATE ON onboarding_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ================================================================
-- FUNÇÃO: get_student_summary(telegram_id)
-- Retorna resumo completo para o painel do Gabriel
-- ================================================================
CREATE OR REPLACE FUNCTION get_student_summary(p_telegram_id BIGINT)
RETURNS TABLE (
    nome            VARCHAR,
    nivel_numerico  SMALLINT,
    fase            VARCHAR,
    status          VARCHAR,
    sessoes_total   INTEGER,
    estruturas_adquiridas INTEGER,
    ultimo_acesso   TIMESTAMP WITH TIME ZONE,
    dias_sem_acesso INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.nome,
        s.nivel_numerico,
        s.fase,
        s.status,
        s.sessoes_total,
        s.estruturas_adquiridas,
        s.ultimo_acesso,
        EXTRACT(DAY FROM NOW() - s.ultimo_acesso)::INTEGER as dias_sem_acesso
    FROM students s
    WHERE s.telegram_id = p_telegram_id;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- VIEW: dashboard_gabriel
-- Painel rápido para o maestro
-- ================================================================
CREATE OR REPLACE VIEW dashboard_gabriel AS
SELECT
    s.telegram_id,
    s.nome,
    s.nivel_numerico,
    s.fase,
    s.interesse,
    s.status,
    s.sessoes_total,
    s.sessoes_streak,
    s.estruturas_adquiridas,
    s.ultimo_acesso,
    EXTRACT(DAY FROM NOW() - s.ultimo_acesso)::INTEGER as dias_sem_acesso,
    CASE
        WHEN EXTRACT(DAY FROM NOW() - s.ultimo_acesso) >= 2 THEN '🔴 ALERTA'
        WHEN EXTRACT(DAY FROM NOW() - s.ultimo_acesso) >= 1 THEN '🟡 ATENÇÃO'
        ELSE '🟢 ATIVO'
    END as saude_flag,
    (
        SELECT COUNT(*) FROM acquisition_memory am
        WHERE am.telegram_id = s.telegram_id AND am.status = 'adquirida'
    ) as estruturas_adquiridas_confirmadas
FROM students s
WHERE s.status IN ('trial', 'ativo')
ORDER BY s.ultimo_acesso DESC;

COMMENT ON VIEW dashboard_gabriel IS 'Painel consolidado para Gabriel monitorar todos os alunos ativos.';

-- ================================================================
-- MIGRATION: Adicionar colunas MANA a databases existentes
-- Executar apenas uma vez em produção (idempotente com IF NOT EXISTS)
-- ================================================================
ALTER TABLE students ADD COLUMN IF NOT EXISTS
    perfil_mana VARCHAR(20) NOT NULL DEFAULT 'travado'
    CHECK (perfil_mana IN ('zero','travado','especialista','multilingue'));

ALTER TABLE students ADD COLUMN IF NOT EXISTS
    idioma_alvo VARCHAR(30) NOT NULL DEFAULT 'ingles';

ALTER TABLE students ADD COLUMN IF NOT EXISTS
    triagem_completa BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN students.perfil_mana IS 'P1=zero | P2=travado | P3=especialista | P4=multilingue — define abertura e ritmo de progressão MANA';
COMMENT ON COLUMN students.idioma_alvo IS 'Para P4 (Multilíngue): idioma-alvo além do inglês (espanhol, mandarin, frances)';
COMMENT ON COLUMN students.triagem_completa IS 'FALSE = perfil inferido pelo onboarding | TRUE = diagnosticado pela triagem conversacional MANA';
