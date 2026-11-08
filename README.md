# Itqan (اتقان)

A multi-tenant LMS where each teacher gets their own branded learning site: courses, protected videos and files, exams, and strict anti-account-sharing.

Itqan is the platform name. Each teacher's site shows its own name, logo, colors and contact links from tenant settings.

## Status

Planning. No code yet. Start with [docs/00-index.md](docs/00-index.md) and [tasks/plan.md](tasks/plan.md).

## Stack (summary)

Next.js + NestJS + Prisma + Neon PostgreSQL + Better Auth + Cloudflare R2 + Resend + FCM, on a Hostinger VPS with Docker Compose, Nginx and Cloudflare. See [docs/03-system-design.md](docs/03-system-design.md).

## Layout (planned)

```text
apps/web      Next.js: public site, student portal, teacher dashboard, super admin
apps/api      NestJS: business logic and authorization
packages/     shared auth config, Prisma client, types and Zod schemas
docs/         product, requirements, design and decisions
tasks/        implementation plan and task list
```
