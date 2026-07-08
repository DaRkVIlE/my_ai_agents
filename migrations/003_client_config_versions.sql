-- Migration 003: Versionamento de Configurações
CREATE TABLE IF NOT EXISTS client_config_versions (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(100) NOT NULL,
    version_number INT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending_review', -- 'pending_review', 'approved', 'active', 'rejected'
    business_name VARCHAR(255) NOT NULL,
    tone VARCHAR(100) DEFAULT 'amigável',
    services JSONB DEFAULT '[]'::jsonb,
    target_audience VARCHAR(255),
    business_rules JSONB DEFAULT '{}'::jsonb,
    examples JSONB DEFAULT '[]'::jsonb,
    raw_config JSONB DEFAULT '{}'::jsonb,
    source VARCHAR(50) DEFAULT 'manager_panel',
    manager_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (client_id, version_number)
);

-- Bloco anônimo para migrar dados se client_configs ainda for uma tabela
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'client_configs' AND table_type = 'BASE TABLE') THEN
        INSERT INTO client_config_versions (
            client_id, version_number, status, business_name, tone, services, target_audience,
            business_rules, examples, raw_config, source, manager_id, created_at
        )
        SELECT 
            client_id, 1, 'active', business_name, tone, services, target_audience,
            business_rules, examples, raw_config, source, manager_id, created_at
        FROM client_configs;

        DROP TABLE client_configs CASCADE;
    END IF;
END $$;

-- Criação da View para o groq.js continuar lendo do mesmo jeito
CREATE OR REPLACE VIEW client_configs AS
SELECT 
    client_id,
    business_name,
    tone,
    services,
    target_audience,
    business_rules,
    examples,
    raw_config,
    source,
    manager_id,
    created_at,
    created_at AS updated_at
FROM client_config_versions
WHERE status = 'active';
