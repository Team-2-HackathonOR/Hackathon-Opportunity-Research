-- Login accounts for the stateless JWT service. Roles are viewer, researcher, and admin.
-- Apply after hackathon_research exists (20261020180000_hackathon_research.sql).
CREATE SCHEMA IF NOT EXISTS hackathon_research;

CREATE TABLE IF NOT EXISTS hackathon_research.app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT app_users_email_unique UNIQUE (email),
    CONSTRAINT app_users_role_check CHECK (role IN ('viewer', 'researcher', 'admin'))
);
