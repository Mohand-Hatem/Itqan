# ADR-008: npm workspaces instead of pnpm

**Status:** Accepted · 2026-11-08

**Context:** The monorepo needs a workspace tool. pnpm is faster and blocks undeclared dependencies; npm ships with Node and every developer already knows it.

**Decision:** Use npm workspaces in one repo (`apps/*`, `packages/*`). No Nx or Turborepo.

**Consequences:** No extra tool to install. npm lets an app import a package it never declared (hoisting), so ESLint's `import/no-extraneous-dependencies` rule runs in every workspace to catch it. Installs are slower and use more disk than pnpm.
