# JWT service

Signs HS256 tokens after a local password check or a Codyza LDAP bind, stores the token id and claim hash in `app_auth.jwt_tokens`, and checks both on `POST /verify`. The account role in `app_auth.app_users` has to match the token. The raw JWT is not stored.

The Kubernetes manifests under [infra/](./infra) reference the `team2-etl` and `team2-scraper` images. For remote or shared clusters, [skaffold.yaml](./skaffold.yaml) is configured to push images so the cluster can pull the generated tag.

## Run locally

1. Apply `supabase/auth/001_auth.sql` on the auth project.
2. Copy `.env.example` to `.env`. Set `AUTH_DATABASE_URL` to that project. Keep `JWT_SECRET` only here. Generate it with `openssl rand -base64 32`.
3. `npm install && npm run dev` (port **4004**).

When the seed email and password variables are set, those three local accounts are created or updated on startup. The frontend calls `POST http://localhost:4000/api/auth/login`, not this port.

Set `LDAP_URL`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_BASE_DN`, and the `LDAP_GROUP_*` names when Codyza directory login should run before the local password check. Set `MAIL_SERVICE_URL` when invite emails should be sent.
