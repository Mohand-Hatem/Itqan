# ADR-003: No Redis or job queue in the MVP

**Status:** Accepted · 2026-11-08

**Context:** One API instance, small load, no heavy background work.

**Decision:** Direct service calls, `@nestjs/schedule` for periodic jobs, in-memory SSE connection map. No Redis, no BullMQ.

**Consequences:** One fewer service to run. Adding a second API instance requires Redis pub/sub for SSE first (see system design §8).
