# SolveKey — Civic Issue Resolution Platform

**Report. Resolve. Improve.**

SolveKey connects citizens with municipal departments, simplifies civic issue reporting, and promotes transparent, accountable public service delivery through technology and AI. Citizens report civic issues with a photo; a multi-agent pipeline (Vision -> Duplicate -> Priority -> Routing -> ReportWriter) classifies, prioritises, routes, and drafts a formal complaint summary.

## Structure
- `backend/` Express API, Socket.IO, agent orchestrator, MCP server (Railway)
- `frontend/` Next.js PWA (Vercel)
- `skills/` Agent Skills (SKILL.md) loaded by agents
- `docs/` [architecture](./docs/architecture.md), [API reference](./docs/api.md), [market research](./docs/market-research.md), and [deployment checklist](./docs/deployment.md)

## Run locally
```bash
cd backend
npm install
npm run db:local          # embedded PostgreSQL, persistent data in backend/.local/
npm run migrate:local
npm run seed:local
npm run dev:local          # always use this for local backend development
npm run mcp              # MCP server (stdio)
npm test                 # Backend unit tests
```

The local startup uses `backend/.env.local` and `frontend/.env.local`; copy each `.env.example` there if needed. Local setup uses persistent embedded PostgreSQL and local image files when Cloudinary keys are empty. `GEMINI_API_KEY` and Cloudinary credentials are optional for startup; without a real Gemini key, AI analysis and assistant responses will be unavailable.

To create an admin and three idempotent demo reports in another environment, set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` (at least 16 characters), then run `npm run seed`. `ADMIN_NAME` is optional. Run the migration first. The seed script will not promote an existing non-admin account or overwrite an existing admin password.

The Next.js frontend is in `frontend/`. Copy `frontend/.env.example` to `frontend/.env.local`, set `NEXT_PUBLIC_API_URL`, then run:
```bash
cd frontend
npm install
npm run dev
```

## Deploy backend on Railway
1. New Project -> Deploy from GitHub repo, set root directory to `backend`
2. Add PostgreSQL plugin (DATABASE_URL is auto-injected)
3. Set variables: JWT_SECRET, GEMINI_API_KEY, FRONTEND_URL, NODE_ENV=production
   and CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET for report image storage.
4. Check `/health`

See the [Vercel and Railway deployment checklist](./docs/deployment.md) before deploying.

## Test the report pipeline
With the backend running and database, Gemini, and Cloudinary credentials configured. Set `SolveKey_API_URL` only if the API is not at `http://localhost:4000`:
```bash
cd backend
npm run test:pipeline                 # uses an embedded 1x1 PNG
npm run test:pipeline -- ./sample.jpg # or use a local JPEG, PNG, or WebP
```

## Agents
See `backend/src/agents/orchestrator.js`. Every step is stored in `agent_logs`; view via `GET /api/reports/:id/trace`.

User levels are recalculated whenever points are awarded: Citizen (0-49), Guardian (50-199), Champion (200-499), and Hero (500+).

Department staff and admins can use the frontend operations dashboard to filter reports by department, sort by severity, and update report statuses. `GET /api/stats` is restricted to those roles and returns open (non-resolved, non-duplicate) and resolved counts, average severity, category totals, and department options. Pass `?department_id=<id>` to filter its stats; `GET /api/reports?department_id=<id>` returns the corresponding report list.
