-- One-time invitation links. The raw token is never stored.
-- Apply after 20261021140000_app_users.sql.
CREATE SCHEMA IF NOT EXISTS hackathon_research;

CREATE TABLE IF NOT EXISTS hackathon_research.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    invited_by UUID NOT NULL REFERENCES hackathon_research.app_users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invitations_role_check CHECK (role IN ('viewer', 'researcher', 'admin')),
    CONSTRAINT invitations_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS invitations_email_idx ON hackathon_research.invitations (email);
