# Itqan (إتقان)

A multi-tenant learning platform. Each teacher gets their own academy at their own subdomain, with their own branding, courses, protected videos and files, exams, and strict anti-account-sharing (device limits and one session at a time).

Itqan is the platform name. Each academy shows its own name, logo, colours and contact links from its settings.

## Status

| Phase | State |
|---|---|
| 1–2 Foundation, database and tenancy | Done |
| 4–9 Backend: auth, devices, access, content, exams, notifications | Done (APIs and tests) |
| 10 Launch preparation (jobs, security headers, security audit and fixes, CI scans, legal drafts, API docs) | Done |
| 11 UI, frontend and security | Waits for the design to be chosen |
| 12 Preview and launch | After Phase 11 |

The full plan is in [tasks/todo.md](tasks/todo.md). Start reading at [docs/00-index.md](docs/00-index.md).

## Stack

npm workspaces monorepo:

```text
apps/web          Next.js (App Router). Today: the Better Auth route handler; pages come in Phase 11
apps/api          NestJS: all business logic and authorization (/api/*)
packages/auth     Better Auth config, student sign-in with device binding, emails
packages/database Prisma client, schema, migrations, tenant-scoping extension
packages/shared   Zod schemas and types shared by web and api
nginx/            Local and staging gateway configs
docs/             Product, requirements, design, decisions (ADRs), legal drafts
tasks/            Plan, step list, security backlog
```

Prisma with PostgreSQL (Docker locally, Neon for dev and production), Better Auth, Cloudflare R2, Resend, server-sent events. See [docs/03-system-design.md](docs/03-system-design.md).

## Setup

Requirements: Node.js 22, npm, Docker Desktop.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment file and fill it in:
   ```bash
   cp .env.example .env
   ```
   The comments in `.env.example` say where each value comes from. The ones you need locally:
   - `DATABASE_URL`, `TEST_DATABASE_URL`: the local Docker Postgres (defaults in the example).
   - `BETTER_AUTH_SECRET`, `ACCESS_CODE_HMAC_SECRET`: two different random 32-byte values. In production the app refuses to start without them.
   - `BETTER_AUTH_URL`, `PLATFORM_ROOT_DOMAIN` (`localhost` locally).
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL` for real emails (tests capture emails in memory instead).
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BUCKET`, `R2_PUBLIC_URL` for file uploads.
3. Start Postgres, apply migrations and seed the demo academy (`demo`):
   ```bash
   npm run db:up
   ```
   ```bash
   npm run db:migrate
   ```
   ```bash
   npm run db:seed
   ```
5. Optional, for manual testing: four test accounts in the seeded academy (`superadmin@`, `teacher@`, `assistant@`, `student@itqan.test`), with the passwords you put in `SEED_STAFF_PASSWORD` and `SEED_STUDENT_PASSWORD` in `.env`. Refused in production.
   ```bash
   npm run db:seed:dev
   ```

**First super admin** (any environment, from the server shell; there is no API route for it, [docs/05 §1c](docs/05-auth-devices.md)): set `SUPER_ADMIN_EMAIL`, then type the password at the prompt. It refuses when a super admin already exists. `-- --recover <email>` sets a new password for an existing super admin. In the production image: `docker compose exec api node packages/auth/dist/bootstrap-cli.js`.
```bash
npm run admin:bootstrap
```

## Run the stack

The local stack runs web, api and Nginx in Docker on port 8080, like production:

```bash
docker compose up -d --build web api nginx
```

For API work with reload on save, run the API alone (port 4000, Swagger UI at `/api/docs`; Postgres must be up):

```bash
npm run dev -w @itqan/api
```

Academies are reached by subdomain: `http://demo.localhost:8080`. Browsers resolve `*.localhost` on their own. For other tools (curl, Postman, Apidog), add this line to your hosts file (`C:\Windows\System32\drivers\etc\hosts` on Windows, `/etc/hosts` elsewhere):

```text
127.0.0.1 demo.localhost
```

## Tests and checks

| Command | What it runs |
|---|---|
| `npm test` | All unit and integration tests (needs Docker Postgres) |
| `npm run test:load` | The 300-student exam-start load test, run alone |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run headers:check` | Security headers on the running local stack |
| `npm run openapi:export` | Regenerates `docs/api/openapi.json` |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, build, Docker builds, `npm audit` and a gitleaks secret scan on every push to `main` and `phase-*` branches.

## API documentation and manual testing

- **Reference:** [docs/07-api.md](docs/07-api.md) lists every endpoint, its roles and its rules.
- **OpenAPI file:** [docs/api/openapi.json](docs/api/openapi.json) describes every route (NestJS and Better Auth) in 15 groups, with request bodies, query parameters, response schemas, examples and error reasons. A test fails if it falls behind the code; run `npm run openapi:export` after changing routes.
- **Where the docs come from:** [apps/api/src/openapi/operations.ts](apps/api/src/openapi/operations.ts) holds one entry per route (summary, rules, schemas, errors, example). The "Who", authentication, tenant-scope and rate-limit lines are generated from the guards, and a role-sweep test checks the guards really behave that way. Every 2xx JSON response in the integration tests is checked against its documented schema.
- **Swagger UI:** `/api/docs` when the API runs outside production (development only; it does not exist in production).

### Swagger "Try it out" (dev gateway)

The docs must be opened on the same origin as the API and the sign-in routes, so the session cookie works. The dev gateway is Nginx in Docker with the production routing, pointed at the dev servers on your machine:

1. Stop the full stack's Nginx if it runs (port 8080): `docker compose stop nginx`.
2. Start Postgres (`docker compose --profile local up -d postgres`) and seed test accounts once (`npm run db:seed:dev`).
3. Run `npm run dev -w @itqan/api` and `npm run dev -w @itqan/web` in two terminals.
4. Start the gateway: `docker compose -f docker-compose.dev.yml up -d`.
5. Open `http://demo.localhost:8080/api/docs` for academy routes, or `http://admin.localhost:8080/api/docs` for platform (super admin) routes. Sign in with `POST /api/auth/sign-in/email` (or `/sign-in/student`) in the "Authentication & Accounts" group; the other calls then carry the cookie.

Stop it with `docker compose -f docker-compose.dev.yml down` (then `docker compose up -d nginx` brings the full stack's Nginx back).

### Import into Apidog or Postman

1. Add `127.0.0.1 demo.localhost` to your hosts file (see above) and start the stack.
2. Import `docs/api/openapi.json`:
   - **Apidog:** Project → Import → OpenAPI/Swagger → choose the file.
   - **Postman:** Import → choose the file → "OpenAPI 3.0" → create a collection.
3. Base URL: set it to `http://demo.localhost:8080` (the file's server is relative, `/`). The academy comes from the host name, so `demo` is the seeded academy; platform routes use `http://admin.localhost:8080`.
4. **Sign in first.** The API uses cookies, not bearer tokens:
   - Staff and super admins: `POST /api/auth/sign-in/email` with `{ "email", "password" }`. There is no second factor ([ADR-012](docs/adr/012-no-two-factor.md)); staff routes work right after sign-in. Public sign-up and other unused Better Auth routes answer 404 ([docs/05 §1d](docs/05-auth-devices.md)).
   - Students: `POST /api/auth/sign-in/student` with `{ "email", "password" }`. This also sets the device cookie.
   The tool keeps the cookies and sends them on the next requests. The device cookie is marked `Secure`; if your tool does not send it over plain `http`, copy its value from the sign-in response into a `Cookie` header.
5. Call any route. Errors carry a `reason` code (for example `ROLE_FORBIDDEN`, `DEVICE_LIMIT`) explained in [docs/07-api.md](docs/07-api.md).

## Project rules

How work is done (step briefs, approvals, tests after every step, database promotion from Docker to Neon `dev` to `main`) is in [CLAUDE.md](CLAUDE.md). Security notes: [docs/09-security.md](docs/09-security.md) and [tasks/security-backlog.md](tasks/security-backlog.md). Legal drafts (privacy policy and terms, Arabic binding): [docs/legal/](docs/legal/).
