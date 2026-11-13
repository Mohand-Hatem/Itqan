# Developer setup: AI tools

Everything below is committed, so a fresh clone gets it. You only approve, sign in, and install two optional extras.

## 1. First run
1. Install Node.js 20+, Python 3.10+ and Claude Code.
2. Open the repo in Claude Code. Approve the project MCP servers when asked (or run `/mcp`).
3. Approve the plugins Claude Code offers: `egm`, `ponytail`, `humanizer`.
4. In `/mcp`, sign in to **neon** and **nestjs-observe** (browser OAuth).
5. Skills in `.claude/skills/` (68) load automatically.
6. Optional: `pip install graphifyy` for the `graphify` skill.

## 2. MCP servers (`.mcp.json`)

| Server | Use it for | Auth |
|---|---|---|
| `playwright` | Drive a real browser: test login, device and exam flows, take screenshots | None |
| `neon` | Dev branches, schema inspection, SQL on **dev branches** | Your Neon account (OAuth) |
| `better-auth` | Better Auth docs and examples | None |
| `next-devtools` | Next.js runtime errors, routes, docs | None |
| `shadcn` | Browse and add shadcn/ui components | None |
| `tanstack` | TanStack docs (Query, Table, …) via the official `@tanstack/cli mcp` | None |
| `nestjs-observe` | Errors, traces and releases from NestJS Observe | NestJS Observe account (OAuth); useful only once the API reports to it |
| `cloudflare` | Cloudflare API (Code Mode: `search` + `execute`): create R2 buckets, set CORS, DNS later. Step 7.1 | Your Cloudflare account (OAuth) |

**Cloudflare rule:** use it on dev buckets and settings only, and confirm each change first. Never create API tokens or keys through it: their secrets would pass through the chat. Create those in the dashboard.

**Neon rule:** never point the Neon MCP at production or at a branch with real student data. Schema changes go through Prisma migrations, not MCP SQL.

## 3. Plugins (`.claude/settings.json`)

| Plugin | Source | Use |
|---|---|---|
| `egm` | google/elephant-goldfish-model | Draft or review design docs with fresh reviewer agents |
| `ponytail` | DietrichGebert/ponytail | Smallest complete change; no over-engineering |
| `humanizer` | blader/humanizer | Plain, human wording in docs, UI copy and replies |

## 4. Skills (`.claude/skills/`, pinned in `skills-lock.json`)

| Source | Skills | Use |
|---|---|---|
| addyosmani/agent-skills (25) | `using-agent-skills`, `spec-driven-development`, `planning-and-task-breakdown`, `incremental-implementation`, `test-driven-development`, `code-review-and-quality`, `security-and-hardening`, `api-and-interface-design`, `frontend-ui-engineering`, `debugging-and-error-recovery`, … | Engineering workflow for every phase |
| obra/superpowers (14) | `using-superpowers`, `brainstorming`, `writing-plans`, `executing-plans`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `using-git-worktrees`, … | Process discipline: plan, verify, review |
| cloudflare/security-audit-skill | `security-audit` | Full security audits (end of each phase, before launch) |
| Graphify-Labs/graphify | `graphify` | Knowledge graph of the codebase (useful once code exists) |
| pbakaus/impeccable | `impeccable` | Design critique, audit, polish |
| Leonxlnx/taste-skill | `design-taste-frontend` | Art direction, visual taste for pages |
| nextlevelbuilder/ui-ux-pro-max-skill (7) | `ui-ux-pro-max`, `design-system`, `ui-styling`, `design`, `brand`, `banner-design`, `slides` | Design knowledge base, tokens, styling, brand assets |
| emilkowalski/skills (17) | `emil-design-eng`, `animate`, `review-animations`, `improve-animations`, `choreograph`, `break-ui`, … | Motion and interaction polish (Swift/Expo ones unused here) |
| Leonxlnx/unlazy | `unlazy` | Deep, thorough work on hard problems |

`test-driven-development` comes from agent-skills; superpowers' copy is skipped to avoid a name clash.

**Precedence when skills disagree:**
1. `CLAUDE.md` workflow rules (step, design, credentials gates) always win.
2. **Code size:** `ponytail` wins. Use `unlazy` for depth of research, testing and verification, not for adding code or features.
3. **Design:** `docs/11-design.md` (written at the design gate) decides which design skill leads. Until then, use `impeccable` for reviews.

**Optional keys:** some design skills (`design`, `design-system`, `design-taste-frontend`) can generate images with `GEMINI_API_KEY` or similar. They follow the credentials gate: never commit these keys.

**Updating:** `npx skills@latest update -p`. Restore from the lock: `npx skills@latest experimental_install`. Review the diff before committing: skills run with full agent permissions.

## 5. Reference only
| Item | How to use |
|---|---|
| [voltagent/awesome-design-md](https://github.com/voltagent/awesome-design-md) | Not a skill. A collection of brand `DESIGN.md` files; at the design gate we may copy one as a starting point for ours. |
| TanStack AI MCP docs page | For apps built with TanStack AI. Replaced by the `tanstack` docs MCP above. |

Add a new skill, plugin or MCP only with a one-line reason in this file.

## 6. Local database and promotion

Order (CLAUDE.md): **Docker → Neon `dev` → Neon `main`**. Postgres 18 everywhere (Docker, CI, Neon).

| Command | What it does |
|---|---|
| `npm run db:up` / `db:down` | Start / stop Postgres 18 in Docker (port 5433, databases `itqan` and `itqan_test`) |
| `npm run db:migrate` | Create and apply a migration on the local `itqan` database (run it in your own terminal: it is interactive) |
| `npm run db:seed` | Create the `demo` tenant if missing (safe to repeat) → `demo.localhost` |
| `npm test` | Applies migrations to `itqan_test`, then runs every unit and integration test |
| `npm run db:promote:dev` | Full test suite on Docker → `migrate deploy` to Neon `dev` (direct URL) → `migrate status` → test query (pooled URL). Stops at the first failure; never resets or drops data |

`.env` rules:
- `DATABASE_URL` and `TEST_DATABASE_URL` always point at **Docker**. Tests refuse any database not named `itqan_test`.
- `NEON_DEV_DATABASE_URL` (pooled, host has `-pooler`) and `NEON_DEV_DIRECT_URL` (direct) point at the Neon **`dev`** branch, with `sslmode=verify-full`.
- The production (`main`) URL is **not** kept in `.env` until step 10.12.

Getting the Neon dev URLs: Neon console → project **Itqan** → branch `dev` → Connect, once with connection pooling on and once off. Or with the CLI: `npx neon@latest login`, then `npx neon@latest connection-string dev --project-id raspy-hill-22852603` (add `--pooled` for the pooled one). Paste into `.env` only.

## 7. Cloudflare R2 (step 7.1)

Files and videos live in R2 (docs/03 §4). Each environment has its own two buckets; for development: `itqan-dev-private` (course files, videos) and `itqan-dev-public` (logos, thumbnails).

1. Create both buckets (dashboard → R2, or through the `cloudflare` MCP after you approve it).
2. Public bucket → Settings → Public access: turn on the `r2.dev` URL. Put it in `R2_PUBLIC_URL`.
3. Dashboard → R2 → Manage API tokens → Create token: **Object Read & Write**, limited to the two buckets. Put the values in `.env` yourself (names in `.env.example`); never in chat, and never create the token through the MCP.
4. Each bucket → Settings → CORS policy → paste:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "http://*.localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

   R2 allows one `*` per origin but not in the port, so each port is listed. Staging and production origins (`https://*.<root>`) are added on their own buckets when those environments exist.
5. Run `npm run r2:check`. It uploads with a presigned URL (curl), reads it back, sends a CORS preflight from each local origin, checks the public URL, and deletes its test objects. It prints statuses only, never URLs or keys.

Presigned PUTs last 15 minutes and sign `Content-Type`, so an upload must send the exact type the API allowed. The R2 integration test (`storage.int.spec.ts`) skips itself when the keys are not in `.env`.

