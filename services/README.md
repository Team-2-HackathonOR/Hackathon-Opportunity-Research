# Microservices

| Service | Port | Status |
|---------|------|--------|
| `hackathon-service` | 4001 | Implemented — Codyza research API + Supabase |
| `jwt-service` | 4004 | Implemented — stateless JWT login and roles |
| `ai-service` | 4002 | Planned — analysis (draft only, human verify) |
| `scraper-service` | 4003 | Planned — discovery leads |

All external traffic enters through **`gateway`** on port 4000.
