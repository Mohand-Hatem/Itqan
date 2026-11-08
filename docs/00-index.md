# Docs index

| File | What it answers |
|---|---|
| [01-prd.md](01-prd.md) | What we build, for whom, MVP scope, business model |
| [02-srs.md](02-srs.md) | Numbered requirements and business rules |
| [03-system-design.md](03-system-design.md) | Architecture, tenancy, storage, notifications, deployment |
| [04-database.md](04-database.md) | ERD and tables |
| [05-auth-devices.md](05-auth-devices.md) | Login, device binding, one-session rule, pausing |
| [06-flows.md](06-flows.md) | Invitations, access codes, enrollment, exams, grade release |
| [07-api.md](07-api.md) | REST endpoints by module |
| [08-frontend.md](08-frontend.md) | Routes, layouts, i18n/RTL |
| [09-security.md](09-security.md) | Threat model and protection limits |
| [10-dev-setup.md](10-dev-setup.md) | MCP servers, skills and plugins for developers |
| [adr/](adr/) | Why each big decision was made |
| [../tasks/plan.md](../tasks/plan.md) | Phases, risks, open questions |
| [../tasks/todo.md](../tasks/todo.md) | Tasks with acceptance criteria |

## Glossary

| Term | Meaning |
|---|---|
| **Platform** | The whole product, run by us. |
| **Super admin** | Us, the platform operator. Manages tenants. |
| **Tenant** | One teacher's site: its subdomain, branding, courses, staff and students. |
| **Teacher** | Owner of a tenant. |
| **Assistant** | Staff member of a tenant, with fewer permissions than the teacher. |
| **Student** | A learner. One global login; a separate membership in each tenant they join. |
| **User** | A global identity (one per email), managed by Better Auth. |
| **Membership** | A user's role and status inside one tenant. |
| **Enrollment** | A student membership's lifetime access to one course. |
| **Access code** | A single-use code sold offline that grants one course. |
| **Invitation** | A single-use email link that registers a student and grants courses. |
| **Device** | A registered browser on one machine, identified by an HttpOnly cookie secret. |
| **Content item** | A node in a course tree: folder, chapter, lecture, file, video or quiz link. |
| **Media asset** | A file or video stored in R2, with its metadata in Postgres. |
| **Attempt** | One student's sitting of one quiz, with a frozen snapshot of its questions. |
