-- Migration 004: Audit Log para configurações
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    actor_type VARCHAR(50) NOT NULL, -- 'manager', 'system', 'admin'
    actor_id VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    target_client_id VARCHAR(100) NOT NULL,
    diff JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_origin VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
