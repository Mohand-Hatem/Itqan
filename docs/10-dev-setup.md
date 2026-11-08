# Developer setup: AI tools

Everything below is committed, so a fresh clone gets it. You only approve and sign in.

## 1. First run
1. Install Node.js 20+ and Claude Code.
2. Open the repo in Claude Code. Approve the project MCP servers when asked (or run `/mcp`).
3. Approve the `egm` plugin when Claude Code offers it.
4. In `/mcp`, sign in to **neon** (opens the browser, OAuth).
5. Skills in `.claude/skills/` load automatically. Nothing to install.

## 2. MCP servers (`.mcp.json`)

| Server | Use it for | Auth |
|---|---|---|
| `playwright` | Drive a real browser: test login, device and exam flows, take screenshots | None |
| `neon` | Create dev branches, inspect schema, run SQL on **dev branches** | Your own Neon account (OAuth) |
| `better-auth` | Search Better Auth docs and examples | None |
| `next-devtools` | Next.js runtime errors, routes, docs | None |
| `shadcn` | Browse and add shadcn/ui components | None |

**Neon rule:** never point the Neon MCP at the production project or a branch with real student data. Neon's own docs say the MCP is for development only. Schema changes go through Prisma migrations, not MCP SQL.

## 3. Skills (`.claude/skills/`, pinned in `skills-lock.json`)

| Skill | When to use |
|---|---|
| `impeccable` | Main design skill: shape, critique, audit and polish any UI |
| `emil-design-eng` | Interaction and design-engineering details |
| `animate` | Adding motion to a component |
| `review-animations` | Checking motion for timing, performance and purpose |
| `security-audit` | Multi-phase security audit; run at the end of each phase and before launch |

Update all skills: `npx skills@latest update -p`. Restore from the lock file: `npx skills@latest experimental_install`. Review the diff before committing updates: skills run with full agent permissions.

`impeccable` downloads its engine binary on first use (checksum-verified, git-ignored).

## 4. Plugin (`.claude/settings.json`)

| Plugin | When to use |
|---|---|
| `egm` (google/elephant-goldfish-model) | Draft or review design docs in `docs/` with fresh reviewer agents |

## 5. Deliberately not used
| Tool | Why |
|---|---|
| TanStack AI MCP | For apps built with TanStack AI, which we don't use |
| NestJS Observe MCP | Needs the NestJS Observe product; we use Sentry. Revisit at launch |
| taste-skill, ui-ux-pro-max | Overlap with impeccable; several design rule sets give inconsistent UI |
| unlazy | Multiplies effort and tokens on every task; conflicts with smallest-change practice |
| awesome-design-md | Reference only: use it to write our own `DESIGN.md` in the UI phase |

Add a new skill or MCP only with a one-line reason in this file.
