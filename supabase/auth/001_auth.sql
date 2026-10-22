-- Access-control schema for jwt-service.
-- Apply on the auth project (the project that holds accounts), not on the scraper project.
-- Safe to run more than once. Copies existing hackathon_research accounts when they are present.
-- Schema name is app_auth. Supabase already owns a schema named auth, and this login cannot create tables there.

create schema if not exists app_auth;

create table if not exists app_auth.app_users (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    password_hash text,
    role text not null,
    auth_source text not null default 'local',
    ldap_dn text,
    created_at timestamptz not null default now(),
    constraint app_users_email_unique unique (email),
    constraint app_users_role_check check (role in ('viewer', 'researcher', 'admin')),
    constraint app_users_auth_source_check check (auth_source in ('local', 'ldap'))
);

create table if not exists app_auth.invitations (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    role text not null,
    token_hash text not null,
    expires_at timestamptz not null,
    used_at timestamptz,
    invited_by uuid not null references app_auth.app_users (id),
    created_at timestamptz not null default now(),
    constraint invitations_role_check check (role in ('viewer', 'researcher', 'admin')),
    constraint invitations_token_hash_unique unique (token_hash)
);

create index if not exists invitations_email_idx on app_auth.invitations (email);

create table if not exists app_auth.jwt_tokens (
    token_id uuid primary key,
    token_sha char(64) not null,
    user_id uuid not null references app_auth.app_users (id),
    role text not null,
    issuer text not null,
    issued_at bigint not null,
    expires_at bigint not null,
    revoked_at bigint,
    created_at timestamptz not null default now(),
    constraint jwt_tokens_role_check check (role in ('viewer', 'researcher', 'admin'))
);

create index if not exists jwt_tokens_user_active_idx
    on app_auth.jwt_tokens (user_id)
    where revoked_at is null;

do $$
begin
    if to_regclass('hackathon_research.app_users') is not null then
        insert into app_auth.app_users (id, email, password_hash, role, auth_source, created_at)
        select id, email, password_hash, role, 'local', created_at
        from hackathon_research.app_users
        on conflict (id) do nothing;
    end if;

    if to_regclass('hackathon_research.invitations') is not null then
        insert into app_auth.invitations (id, email, role, token_hash, expires_at, used_at, invited_by, created_at)
        select id, email, role, token_hash, expires_at, used_at, invited_by, created_at
        from hackathon_research.invitations
        on conflict (id) do nothing;
    end if;
end $$;
